// noinspection DuplicatedCode

import {
  AdminActivityDto,
  MapDto,
  ReportDto,
  UserDto
} from '../../backend/src/app/dto';

import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ActivityType,
  AdminActivityType,
  Ban,
  Gamemode,
  MapCreditType,
  MapStatus,
  MapStatusNew,
  MapSubmissionType,
  MapTestingRequestState,
  ReportCategory,
  ReportType,
  Role,
  runPath,
  TrackType
} from '@momentum/constants';
import { Bitflags } from '@momentum/bitflags';
import { Enum } from '@momentum/enum';
import {
  AuthUtil,
  createSha1Hash,
  DbUtil,
  FILES_PATH,
  FileStoreUtil,
  NULL_ID,
  RequestUtil
} from '@momentum/test-utils';
import { Prisma, PrismaClient } from '@prisma/client';
import Zip from 'adm-zip';
import {
  BabyZonesStub,
  ZonesStub,
  ZonesStubLeaderboards
} from '@momentum/formats/zone';
import { JsonValue } from 'type-fest';
import {
  setupE2ETestEnvironment,
  teardownE2ETestEnvironment
} from './support/environment';

describe('Admin', () => {
  let app,
    prisma: PrismaClient,
    req: RequestUtil,
    db: DbUtil,
    fileStore: FileStoreUtil,
    auth: AuthUtil,
    adminActivityWasCreated: (
      userID: number,
      types: AdminActivityType[]
    ) => Promise<boolean>;

  beforeAll(async () => {
    const env = await setupE2ETestEnvironment();
    app = env.app;
    prisma = env.prisma;
    req = env.req;
    db = env.db;
    auth = env.auth;
    fileStore = env.fileStore;
    adminActivityWasCreated = async (
      userID: number,
      types: AdminActivityType[]
    ) => {
      const adminActivitiesTypes = await prisma.adminActivity.findMany({
        where: { userID }
      });
      for (const activity of adminActivitiesTypes) {
        if (!types.includes(activity.type)) return false;
        types = types.filter((type) => type != activity.type);
      }
      return types.length === 0;
    };
  });

  afterAll(() => teardownE2ETestEnvironment(app));

  describe('admin/users', () => {
    describe('POST', () => {
      let modToken, admin, adminToken, nonAdminToken;

      beforeAll(async () => {
        [modToken, [admin, adminToken], nonAdminToken] = await Promise.all([
          db.loginNewUser({ data: { roles: Role.MODERATOR } }),
          db.createAndLoginUser({ data: { roles: Role.ADMIN } }),
          db.loginNewUser()
        ]);
      });

      afterAll(() => db.cleanup('user', 'adminActivity'));

      it('should successfully create a placeholder user', async () => {
        const res = await req.post({
          url: 'admin/users',
          status: 201,
          body: { alias: 'Burger' },
          token: adminToken,
          validate: UserDto
        });

        expect(res.body.alias).toBe('Burger');
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.USER_CREATE_PLACEHOLDER
          ])
        ).toBe(true);
      });

      it('should 403 when the user requesting only is a moderator', () =>
        req.post({
          url: 'admin/users',
          status: 403,
          body: { alias: 'Barry 2' },
          token: modToken
        }));

      it('should 403 when the user requesting is not an admin', () =>
        req.post({
          url: 'admin/users',
          status: 403,
          body: { alias: 'Barry 2' },
          token: nonAdminToken
        }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/users', 'post'));
    });
  });

  describe('admin/users/merge', () => {
    describe('POST', () => {
      let u1, u1Token, u2, mu1, mu2, admin, adminToken, modToken;

      beforeEach(async () => {
        [[u1, u1Token], u2, mu1, mu2, [admin, adminToken], modToken] =
          await Promise.all([
            db.createAndLoginUser(),
            db.createUser(),
            db.createUser({
              data: { roles: Role.PLACEHOLDER }
            }),
            db.createUser(),
            db.createAndLoginUser({ data: { roles: Role.ADMIN } }),
            db.loginNewUser({
              data: { roles: Role.MODERATOR }
            })
          ]);

        await prisma.follow.createMany({
          data: [
            { followeeID: u1.id, followedID: mu1.id },
            {
              followeeID: u2.id,
              followedID: mu1.id,
              notifyOn: ActivityType.MAP_APPROVED,
              createdAt: new Date('12/24/2021')
            },
            {
              followeeID: u2.id,
              followedID: mu2.id,
              notifyOn: ActivityType.MAP_UPLOADED,
              createdAt: new Date('12/25/2021')
            },
            { followeeID: mu2.id, followedID: mu1.id }
          ]
        });

        await prisma.activity.create({
          data: { type: ActivityType.REPORT_FILED, userID: mu1.id, data: 1n }
        });
      });

      afterAll(() => db.cleanup('user', 'adminActivity'));

      it('should merge two accounts together', async () => {
        const res = await req.post({
          url: 'admin/users/merge',
          status: 201,
          body: { placeholderID: mu1.id, userID: mu2.id },
          token: adminToken,
          validate: UserDto
        });

        expect(res.body.id).toBe(mu2.id);
        expect(res.body.alias).toBe(mu2.alias);

        // U1 was following MU1, that should be transferred to MU2.
        const u1Follow = await prisma.follow.findFirst({
          where: { followeeID: u1.id, followedID: mu2.id }
        });
        expect(u1Follow.followeeID).toBeTruthy();

        // U2 was following MU1 and MU2, the creation data should be earliest
        // of the two and the notifyOn flags combined.
        const u2Follow = await prisma.follow.findFirst({
          where: { followeeID: u2.id, followedID: mu2.id }
        });
        expect(new Date(u2Follow.createdAt)).toEqual(new Date('12/24/2021'));
        expect(u2Follow.notifyOn).toBe(
          ActivityType.MAP_APPROVED | ActivityType.MAP_UPLOADED
        );

        // MU2 was following MU1, that should be deleted
        const mu2Follows = await prisma.follow.findFirst({
          where: { followeeID: mu2.id, followedID: mu1.id }
        });
        expect(mu2Follows).toBeNull();

        // MU1's activities should have been transferred to MU2

        const mu2Activities = await prisma.activity.findFirst({
          where: { userID: mu2.id }
        });
        expect(mu2Activities.type).toBe(ActivityType.REPORT_FILED);

        // Placeholder should have been deleted
        const mu1DB = await prisma.user.findFirst({ where: { id: mu1.id } });
        expect(mu1DB).toBeNull();
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.USER_MERGE
          ])
        ).toBe(true);
      });

      it('should 400 if the user to merge from is not a placeholder', () =>
        req.post({
          url: 'admin/users/merge',
          status: 400,
          body: { placeholderID: u1.id, userID: mu2.id },
          token: adminToken
        }));

      it('should 400 if the user to merge from does not exist', () =>
        req.post({
          url: 'admin/users/merge',
          status: 400,
          body: { placeholderID: NULL_ID, userID: mu2.id },
          token: adminToken
        }));

      it('should 400 if the user to merge to does not exist', () =>
        req.post({
          url: 'admin/users/merge',
          status: 400,
          body: { placeholderID: mu1.id, userID: NULL_ID },
          token: adminToken
        }));

      it('should 400 if the user to merge are the same user', () =>
        req.post({
          url: 'admin/users/merge',
          status: 400,
          body: { placeholderID: mu1.id, userID: mu1.id },
          token: adminToken
        }));

      it('should 403 when the user requesting is only a moderator', () =>
        req.post({
          url: 'admin/users/merge',
          status: 403,
          body: { placeholderID: mu1.id, userID: mu2.id },
          token: modToken
        }));

      it('should 403 when the user requesting is not an admin', () =>
        req.post({
          url: 'admin/users/merge',
          status: 403,
          body: { placeholderID: mu1.id, userID: mu2.id },
          token: u1Token
        }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/users/merge', 'post'));
    });
  });

  describe('admin/users/{userID}', () => {
    describe('PATCH', () => {
      let admin,
        adminToken,
        adminGameToken,
        admin2,
        u1,
        u1Token,
        u2,
        u3,
        mod,
        modToken,
        mod2;

      beforeEach(async () => {
        [
          [admin, adminToken],
          admin2,
          [u1, u1Token],
          u2,
          u3,
          [mod, modToken],
          mod2
        ] = await Promise.all([
          db.createAndLoginUser({
            data: { roles: Role.ADMIN }
          }),
          db.createUser({ data: { roles: Role.ADMIN } }),
          db.createAndLoginUser(),
          db.createUser({ data: { roles: Role.VERIFIED } }),
          db.createUser({ data: { roles: Role.VERIFIED } }),
          db.createAndLoginUser({ data: { roles: Role.MODERATOR } }),
          db.createUser({ data: { roles: Role.MODERATOR } })
        ]);
        adminGameToken = auth.gameLogin(admin);
      });

      afterEach(() => db.cleanup('adminActivity'));

      afterAll(() => db.cleanup('user'));

      it("should successfully update a specific user's alias", async () => {
        await req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { alias: 'Barry 2' },
          token: adminToken
        });

        const res = await req.get({
          url: `users/${u1.id}`,
          status: 200,
          token: adminToken
        });

        expect(res.body.alias).toBe('Barry 2');
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.USER_UPDATE_ALIAS
          ])
        ).toBe(true);
      });

      it("should 409 when an admin tries to set a verified user's alias to something used by another verified user", () =>
        req.patch({
          url: `admin/users/${u2.id}`,
          status: 409,
          body: { alias: u3.alias },
          token: adminToken
        }));

      it("should allow an admin to set a verified user's alias to something used by another unverified user", () =>
        req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { alias: mod.alias },
          token: adminToken
        }));

      it("should allow an admin to set a unverified user's alias to something used by another verified user", () =>
        req.patch({
          url: `admin/users/${mod.id}`,
          status: 204,
          body: { alias: u2.alias },
          token: adminToken
        }));

      it("should successfully update a specific user's bio", async () => {
        const bio = "I'm hungry";
        await req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { bio: bio },
          token: adminToken
        });

        const res = await req.get({
          url: `users/${u1.id}/profile`,
          status: 200,
          token: adminToken
        });

        expect(res.body.bio).toBe(bio);
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.USER_UPDATE_BIO
          ])
        ).toBe(true);
      });

      it("should successfully update a specific user's bans", async () => {
        const bans = Bitflags.join(Ban.AVATAR, Ban.LEADERBOARDS);

        await req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { bans: bans },
          token: adminToken
        });

        const userDB = await prisma.user.findFirst({ where: { id: u1.id } });

        expect(userDB.bans).toBe(bans);
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.USER_UPDATE_BANS
          ])
        ).toBe(true);
      });

      it("should successfully update a specific user's roles", async () => {
        await req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { roles: Role.MAPPER },
          token: adminToken
        });

        const userDB = await prisma.user.findFirst({ where: { id: u1.id } });

        expect(Bitflags.has(userDB.roles, Role.MAPPER)).toBe(true);
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.USER_UPDATE_ROLES
          ])
        ).toBe(true);
      });

      it('should allow an admin to make a regular user a moderator', () =>
        req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { roles: Role.MODERATOR },
          token: adminToken
        }));

      it("should allow an admin to update a moderator's roles", () =>
        req.patch({
          url: `admin/users/${mod.id}`,
          status: 204,
          body: { roles: Role.MAPPER },
          token: adminToken
        }));

      it('should allow an admin to remove a user as moderator', () =>
        req.patch({
          url: `admin/users/${mod.id}`,
          status: 204,
          body: { roles: 0 },
          token: adminToken
        }));

      it("should not allow an admin to update another admin's roles", () =>
        req.patch({
          url: `admin/users/${admin2.id}`,
          status: 403,
          body: { roles: Role.MAPPER },
          token: adminToken
        }));

      it('should allow an admin to update their own non-admin roles', () =>
        req.patch({
          url: `admin/users/${admin.id}`,
          status: 204,
          body: { roles: Role.MAPPER },
          token: adminToken
        }));

      it('should allow an admin to update their own moderator role', () =>
        req.patch({
          url: `admin/users/${admin.id}`,
          status: 204,
          body: { roles: Role.MODERATOR },
          token: adminToken
        }));

      it('should allow an admin to update their own admin role', () =>
        req.patch({
          url: `admin/users/${admin.id}`,
          status: 204,
          body: { roles: 0 },
          token: adminToken
        }));

      it("should successfully allow a moderator to update a specific user's roles", () =>
        req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { roles: Role.MAPPER },
          token: modToken
        }));

      it('should not allow a moderator to make another user a moderator', () =>
        req.patch({
          url: `admin/users/${u1.id}`,
          status: 403,
          body: { roles: Role.MODERATOR },
          token: modToken
        }));

      it("should not allow a moderator to update another moderator's roles", () =>
        req.patch({
          url: `admin/users/${mod2.id}`,
          status: 403,
          body: { roles: 0 },
          token: modToken
        }));

      it("should not allow a moderator to update an admin's roles", () =>
        req.patch({
          url: `admin/users/${admin2.id}`,
          status: 403,
          body: { roles: Role.MAPPER },
          token: modToken
        }));

      it('should allow a moderator to update their own non-mod roles', () =>
        req.patch({
          url: `admin/users/${mod.id}`,
          status: 204,
          body: { roles: Bitflags.join(Role.MAPPER, Role.MODERATOR) },
          token: modToken
        }));

      it('should not allow a moderator to update their own mod role', () =>
        req.patch({
          url: `admin/users/${mod.id}`,
          status: 403,
          body: { roles: 0 },
          token: modToken
        }));

      it('should 403 when the user requesting is not an admin', () =>
        req.patch({
          url: `admin/users/${u1.id}`,
          status: 403,
          body: { alias: 'Barry 2' },
          token: u1Token
        }));

      it('should 403 when authenticated from game', () =>
        req.patch({
          url: `admin/users/${u1.id}`,
          status: 403,
          body: { roles: Role.MAPPER },
          token: adminGameToken
        }));

      it('should 401 when no access token is provided', () =>
        req.patch({ url: `admin/users/${u1.id}`, status: 401 }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/users/1', 'patch'));
    });

    describe('DELETE', () => {
      let u1, u1Token, admin, adminToken, modToken;

      beforeEach(async () => {
        [[u1, u1Token], [admin, adminToken], modToken] = await Promise.all([
          db.createAndLoginUser(),
          db.createAndLoginUser({ data: { roles: Role.ADMIN } }),
          db.loginNewUser({ data: { roles: Role.MODERATOR } })
        ]);
      });

      afterEach(() => db.cleanup('leaderboardRun', 'pastRun', 'user'));

      afterAll(() =>
        db.cleanup(
          'mMap',
          'report',
          'activity',
          'deletedSteamID',
          'adminActivity'
        )
      );

      it('should delete user data. leaving user with Role.DELETED', async () => {
        const followeeUser = await db.createUser();
        const map = await db.createMap();

        const user = await prisma.user.create({
          data: {
            roles: Role.MAPPER,
            bans: Ban.BIO,
            steamID: 12345,
            alias: 'User to be deleted',
            avatar: 'yeeeee',
            country: 'NA',
            userAuth: { create: { refreshToken: 'yeeeee' } },
            profile: {
              create: { bio: 'yeeeee', socials: { RandomSocial: 'bemyguest' } }
            },
            userStats: { create: { totalJumps: 100 } },
            submittedMaps: { connect: [{ id: map.id }] },
            mapCredits: {
              create: { type: MapCreditType.AUTHOR, mapID: map.id }
            },
            mapFavorites: { create: { mmap: { connect: { id: map.id } } } },
            mapLibraryEntries: {
              create: { mmap: { connect: { id: map.id } } }
            },
            reviewsSubmitted: {
              create: {
                mmap: { connect: { id: map.id } },
                mainText: "That's a good map"
              }
            },
            reviewsResolved: {
              create: {
                mmap: { connect: { id: map.id } },
                resolved: true,
                mainText: 'This map sucks',
                reviewer: {
                  connect: {
                    id: followeeUser.id // Whatever, any user is fine
                  }
                }
              }
            },
            follows: {
              create: { followed: { connect: { id: followeeUser.id } } }
            },
            followers: {
              create: { followee: { connect: { id: followeeUser.id } } }
            },
            mapNotifies: {
              create: { mmap: { connect: { id: map.id } }, notifyOn: 8 }
            },
            runSessions: {
              create: {
                mapID: map.id,
                gamemode: Gamemode.AHOP,
                trackNum: 1,
                trackType: TrackType.MAIN
              }
            }
          }
        });

        await db.createPastRun({
          map: map,
          user: user,
          createLbRun: true,
          lbRank: 1
        });
        await prisma.activity.create({
          data: {
            type: ActivityType.MAP_APPROVED,
            data: 123,
            notifications: {
              create: {
                read: true,
                user: { connect: { id: user.id } }
              }
            },
            user: { connect: { id: user.id } }
          }
        });

        await prisma.report.create({
          data: {
            data: 123,
            type: ReportType.MAP_REPORT,
            category: ReportCategory.INAPPROPRIATE_CONTENT,
            message: 'yeeeee',
            resolved: true,
            resolutionMessage: 'yeeeeee',
            submitter: { connect: { id: user.id } },
            resolver: { connect: { id: user.id } }
          }
        });

        const userBeforeDeletion = await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            userAuth: true,
            profile: true,
            userStats: true,
            submittedMaps: true,
            mapCredits: true,
            mapFavorites: true,
            mapLibraryEntries: true,
            pastRuns: true,
            leaderboardRuns: true,
            reviewsResolved: true,
            reviewsSubmitted: true,
            activities: true,
            follows: true,
            followers: true,
            mapNotifies: true,
            notifications: true,
            runSessions: true,
            reportSubmitted: true,
            reportResolved: true
          }
        });

        await req.del({
          url: `admin/users/${userBeforeDeletion.id}`,
          status: 204,
          token: adminToken
        });

        const deletedUser = await prisma.user.findUnique({
          where: { id: user.id },
          include: {
            userAuth: true,
            profile: true,
            userStats: true,
            submittedMaps: true,
            mapCredits: true,
            mapFavorites: true,
            mapLibraryEntries: true,
            pastRuns: true,
            leaderboardRuns: true,
            reviewsSubmitted: true,
            reviewsResolved: true,
            activities: true,
            follows: true,
            followers: true,
            mapNotifies: true,
            notifications: true,
            runSessions: true,
            reportSubmitted: true,
            reportResolved: true
          }
        });

        const deletedSteamIDEntry = await prisma.deletedSteamID.findUnique({
          where: { steamID: userBeforeDeletion.steamID }
        });

        expect(deletedUser).toMatchObject({
          roles: Role.DELETED,
          bans: userBeforeDeletion.bans,
          steamID: null,
          alias: 'Deleted User',
          avatar: null,
          country: null,
          userAuth: null,
          profile: { bio: '', socials: {} },
          userStats: userBeforeDeletion.userStats,
          submittedMaps: userBeforeDeletion.submittedMaps,
          mapCredits: userBeforeDeletion.mapCredits,
          mapFavorites: [],
          mapLibraryEntries: [],
          reviewsSubmitted: userBeforeDeletion.reviewsSubmitted,
          activities: [],
          follows: [],
          followers: [],
          mapNotifies: userBeforeDeletion.mapNotifies,
          notifications: [],
          runSessions: [],
          leaderboardRuns: userBeforeDeletion.leaderboardRuns,
          pastRuns: userBeforeDeletion.pastRuns,
          reportSubmitted: userBeforeDeletion.reportSubmitted,
          reportResolved: userBeforeDeletion.reportResolved
        });

        expect(deletedSteamIDEntry).toBeTruthy();
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.USER_DELETE
          ])
        ).toBe(true);
      });

      it('should 403 when the user requesting only is a moderator', () =>
        req.del({ url: `admin/users/${u1.id}`, status: 403, token: modToken }));

      it('should 403 when the user requesting is not an admin', () =>
        req.del({ url: `admin/users/${u1.id}`, status: 403, token: u1Token }));

      it('should 401 when no access token is provided', () =>
        req.del({ url: `admin/users/${u1.id}`, status: 401 }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/users/1', 'del'));
    });
  });

  describe('admin/maps', () => {
    describe('GET', () => {
      let modToken,
        adminToken,
        reviewerToken,
        u1,
        u1Token,
        m1,
        m2,
        m3,
        m4,
        caMap,
        faMap;

      beforeAll(async () => {
        [modToken, adminToken, reviewerToken, [u1, u1Token], [m1, m2, m3, m4]] =
          await Promise.all([
            db.loginNewUser({ data: { roles: Role.MODERATOR } }),
            db.loginNewUser({ data: { roles: Role.ADMIN } }),
            db.loginNewUser({ data: { roles: Role.REVIEWER } }),
            db.createAndLoginUser(),
            db.createMaps(4)
          ]);

        await db.createMap({ status: MapStatusNew.PRIVATE_TESTING });
        caMap = await db.createMap({ status: MapStatusNew.CONTENT_APPROVAL });
        faMap = await db.createMap({ status: MapStatusNew.FINAL_APPROVAL });
        await db.createMap({ status: MapStatusNew.PUBLIC_TESTING });
        await db.createMap({ status: MapStatusNew.DISABLED });
      });

      afterAll(() => db.cleanup('leaderboardRun', 'user', 'mMap'));

      it('should respond with map data', async () => {
        const res = await req.get({
          url: 'admin/maps',
          status: 200,
          validatePaged: { type: MapDto },
          token: adminToken
        });

        expect(res.body).not.toHaveProperty('zones');
      });

      it('should include maps with any map statuses by default', () =>
        req.get({
          url: 'admin/maps',
          status: 200,
          validatePaged: { type: MapDto, count: 9 },
          token: adminToken
        }));

      it('should include maps with any map statuses by default', () =>
        req.get({
          url: 'admin/maps',
          status: 200,
          validatePaged: { type: MapDto, count: 9 },
          token: adminToken
        }));

      it('should be ordered by date', () =>
        req.sortByDateTest({
          url: 'admin/maps',
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with filtered map data using the take parameter', () =>
        req.takeTest({
          url: 'admin/maps',
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with filtered map data using the skip parameter', () =>
        req.skipTest({
          url: 'admin/maps',
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with filtered map data using the search parameter', async () => {
        m2 = await prisma.mMap.update({
          where: { id: m2.id },
          data: { name: 'aaaaa' }
        });

        await req.searchTest({
          url: 'admin/maps',
          token: adminToken,
          searchMethod: 'contains',
          searchString: 'aaaaa',
          searchPropertyName: 'name',
          validate: { type: MapDto, count: 1 }
        });
      });

      it('should respond with filtered map data using the submitter id parameter', async () => {
        await prisma.mMap.update({
          where: { id: m2.id },
          data: { submitterID: u1.id }
        });

        const res = await req.get({
          url: 'admin/maps',
          status: 200,
          query: { submitterID: u1.id },
          validatePaged: { type: MapDto, count: 1 },
          token: adminToken
        });

        expect(res.body.data[0]).toMatchObject({
          submitterID: u1.id,
          id: m2.id
        });
      });

      it('should filter by maps when given the filter paramete', async () => {
        const res = await req.get({
          url: 'admin/maps/submissions',
          status: 200,
          query: {
            filter: `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.FINAL_APPROVAL}`
          },
          validatePaged: { type: MapDto, count: 2 },
          token: adminToken
        });

        expect(res.body.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: caMap.id }),
            expect.objectContaining({ id: faMap.id })
          ])
        );
      });

      it('should respond with expanded submitter data using the submitter expand parameter', async () => {
        await prisma.mMap.updateMany({ data: { submitterID: u1.id } });

        await req.expandTest({
          url: 'admin/maps',
          expand: 'submitter',
          paged: true,
          validate: MapDto,
          token: adminToken
        });
      });

      it('should respond with expanded map data using the credits expand parameter', async () => {
        await prisma.mapCredit.createMany({
          data: [
            { mapID: m1.id, userID: u1.id, type: MapCreditType.AUTHOR },
            { mapID: m2.id, userID: u1.id, type: MapCreditType.AUTHOR },
            { mapID: m3.id, userID: u1.id, type: MapCreditType.AUTHOR },
            { mapID: m4.id, userID: u1.id, type: MapCreditType.AUTHOR }
          ]
        });

        await req.expandTest({
          url: 'admin/maps',
          expand: 'credits',
          paged: true,
          some: true,
          validate: MapDto,
          token: adminToken
        });
      });

      it('should respond with expanded map data using the thumbnail expand parameter', () =>
        req.expandTest({
          url: 'admin/maps',
          expand: 'thumbnail',
          paged: true,
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with expanded map data using the images expand parameter', () =>
        req.expandTest({
          url: 'admin/maps',
          expand: 'images',
          paged: true,
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with expanded map data using the stats expand parameter', () =>
        req.expandTest({
          url: 'admin/maps',
          expand: 'stats',
          paged: true,
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with expanded map data using the leaderboards expand parameter', () =>
        req.expandTest({
          url: 'admin/maps',
          expand: 'leaderboards',
          paged: true,
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with expanded map data using the zones expand parameter', () =>
        req.expandTest({
          url: 'admin/maps',
          expand: 'zones',
          paged: true,
          validate: MapDto,
          token: adminToken
        }));

      it('should respond with expanded map data using the info expand parameter', () =>
        req.expandTest({
          url: 'admin/maps',
          expand: 'info',
          paged: true,
          validate: MapDto,
          token: adminToken
        }));

      it('should return 403 if a regular access token is given', () =>
        req.get({
          url: 'admin/maps',
          status: 403,
          token: u1Token
        }));

      it('should return 403 if a reviewer token is given', () =>
        req.get({
          url: 'admin/maps',
          status: 403,
          token: reviewerToken
        }));

      it('should accept if a mod access token is given', () =>
        req.get({
          url: 'admin/maps',
          status: 200,
          token: modToken
        }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/maps', 'get'));
    });
  });

  describe('admin/maps/submissions', () => {
    describe('GET', () => {
      let user,
        token,
        reviewer,
        reviewerToken,
        modToken,
        adminToken,
        pubMap1,
        pubMap2,
        privMap,
        caMap,
        faMap;

      beforeAll(async () => {
        [[user, token], [reviewer, reviewerToken], modToken, adminToken] =
          await Promise.all([
            db.createAndLoginUser(),
            db.createAndLoginUser({ data: { roles: Role.REVIEWER } }),
            db.loginNewUser({ data: { roles: Role.MODERATOR } }),
            db.loginNewUser({ data: { roles: Role.ADMIN } })
          ]);

        const submissionCreate = {
          create: {
            type: MapSubmissionType.ORIGINAL,
            suggestions: [
              {
                trackNum: 0,
                trackType: TrackType.MAIN,
                gamemode: Gamemode.DEFRAG_CPM,
                tier: 1,
                ranked: true,
                comment: 'This stage was built by children'
              }
            ],
            versions: {
              createMany: {
                data: [
                  { versionNum: 1, hash: createSha1Hash('chips') },
                  { versionNum: 2, hash: createSha1Hash('fries') }
                ]
              }
            }
          }
        };
        await db.createMap({ status: MapStatusNew.APPROVED });
        pubMap1 = await db.createMap({
          status: MapStatusNew.PUBLIC_TESTING,
          submission: submissionCreate,
          reviews: {
            create: {
              mainText: 'Atrocious',
              reviewer: { connect: { id: user.id } }
            }
          }
        });
        pubMap2 = await db.createMap({
          status: MapStatusNew.PUBLIC_TESTING,
          submission: submissionCreate
        });
        privMap = await db.createMap({
          status: MapStatusNew.PRIVATE_TESTING,
          submission: submissionCreate
        });
        caMap = await db.createMap({
          status: MapStatusNew.CONTENT_APPROVAL,
          submission: submissionCreate
        });
        faMap = await db.createMap({
          status: MapStatusNew.FINAL_APPROVAL,
          submission: submissionCreate
        });

        await Promise.all(
          [pubMap1, pubMap2, privMap, caMap, faMap].map((map) =>
            prisma.mapSubmission.update({
              where: { mapID: map.id },
              data: {
                currentVersion: {
                  connect: { id: map.submission.versions[1].id }
                }
              }
            })
          )
        );
      });

      afterAll(() => db.cleanup('leaderboardRun', 'user', 'mMap'));
      afterEach(() => db.cleanup('mapTestingRequest', 'mapCredit'));

      it('should respond with map data', async () => {
        const res = await req.get({
          url: 'admin/maps/submissions',
          status: 200,
          validatePaged: { type: MapDto },
          token: reviewerToken
        });

        for (const item of res.body.data) {
          expect(item).not.toHaveProperty('zones');
          expect(item).toHaveProperty('submission');
        }
      });

      it('should 403 if the user is not reviewer, mod, or admin', () =>
        req.get({
          url: 'admin/maps/submissions',
          status: 403,
          validatePaged: { type: MapDto },
          token
        }));

      it('should be ordered by date', () =>
        req.sortByDateTest({
          url: 'admin/maps/submissions',
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with filtered map data using the take parameter', () =>
        req.takeTest({
          url: 'admin/maps/submissions',
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with filtered map data using the skip parameter', () =>
        req.skipTest({
          url: 'admin/maps/submissions',
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with filtered map data using the search parameter', async () => {
        await prisma.mMap.update({
          where: { id: pubMap1.id },
          data: { name: 'aaaaa' }
        });

        await req.searchTest({
          url: 'admin/maps/submissions',
          token: reviewerToken,
          searchMethod: 'contains',
          searchString: 'aaaaa',
          searchPropertyName: 'name',
          validate: { type: MapDto, count: 1 }
        });
      });

      it('should respond with filtered map data using the submitter id parameter', async () => {
        await prisma.mMap.update({
          where: { id: pubMap1.id },
          data: { submitterID: user.id }
        });

        const res = await req.get({
          url: 'admin/maps/submissions',
          status: 200,
          query: { submitterID: user.id },
          validatePaged: { type: MapDto, count: 1 },
          token: reviewerToken
        });

        expect(res.body.data[0]).toMatchObject({
          submitterID: user.id,
          id: pubMap1.id
        });

        await prisma.mMap.update({
          where: { id: pubMap1.id },
          data: { submitterID: null }
        });
      });

      it('should respond with expanded current submission version data using the currentVersion expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'currentVersion',
          expectedPropertyName: 'submission.currentVersion',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded submission versions data using the version expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'versions',
          expectedPropertyName: 'submission.versions[1]',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded review data using the reviews expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'reviews',
          paged: true,
          some: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded map data using the credits expand parameter', async () => {
        await prisma.mapCredit.createMany({
          data: [
            {
              mapID: pubMap1.id,
              userID: reviewer.id,
              type: MapCreditType.AUTHOR
            }
          ]
        });

        await req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'credits',
          expectedPropertyName: 'credits[0].user', // This should always include user as well
          paged: true,
          some: true,
          validate: MapDto,
          token: reviewerToken
        });

        await db.cleanup('mapCredit');
      });

      it('should respond with expanded submitter data using the submitter expand parameter', async () => {
        await prisma.mMap.update({
          where: { id: pubMap1.id },
          data: { submitterID: reviewer.id }
        });

        await req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'submitter',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        });

        await prisma.mMap.update({
          where: { id: pubMap1.id },
          data: { submitterID: null }
        });
      });

      it('should respond with expanded map data using the thumbnail expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'thumbnail',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded map data using the images expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'images',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded map data using the stats expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'stats',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded map data using the leaderboards expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'leaderboards',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded map data using the zones expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'zones',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it('should respond with expanded map data using the info expand parameter', () =>
        req.expandTest({
          url: 'admin/maps/submissions',
          expand: 'info',
          paged: true,
          validate: MapDto,
          token: reviewerToken
        }));

      it("should respond with expanded map data if the map is in the logged in user's library when using the inFavorites expansion", async () => {
        await prisma.mapFavorite.create({
          data: { userID: user.id, mapID: pubMap1.id }
        });
      });

      describe('Reviewer checks', () => {
        it('should respond with public testing and CONTENT_APPROVAL maps if the reviewer has no special relations', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            validatePaged: { type: MapDto, count: 3 },
            token: reviewerToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id }),
              expect.objectContaining({ id: caMap.id })
            ])
          );
        });

        it('should include private testing maps for which the user has an accepted invite', async () => {
          await prisma.mapTestingRequest.create({
            data: {
              userID: reviewer.id,
              mapID: privMap.id,
              state: MapTestingRequestState.ACCEPTED
            }
          });

          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            validatePaged: { type: MapDto, count: 4 },
            token: reviewerToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id }),
              expect.objectContaining({ id: caMap.id }),
              expect.objectContaining({ id: privMap.id })
            ])
          );
        });

        it('should not include a private testing map if the user has an declined invite', async () => {
          await prisma.mapTestingRequest.create({
            data: {
              userID: reviewer.id,
              mapID: privMap.id,
              state: MapTestingRequestState.DECLINED
            }
          });

          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            validatePaged: { type: MapDto, count: 3 },
            token: reviewerToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id }),
              expect.objectContaining({ id: caMap.id })
            ])
          );
        });

        it('should include private testing maps for which the user is in the credits', async () => {
          await prisma.mapCredit.create({
            data: {
              userID: reviewer.id,
              mapID: privMap.id,
              type: MapCreditType.TESTER
            }
          });

          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            validatePaged: { type: MapDto, count: 4 },
            token: reviewerToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id }),
              expect.objectContaining({ id: caMap.id }),
              expect.objectContaining({ id: privMap.id })
            ])
          );
        });

        it('should include private testing maps for which the user is the submitter', async () => {
          await prisma.mMap.update({
            where: { id: privMap.id },
            data: { submitter: { connect: { id: reviewer.id } } }
          });

          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            validatePaged: { type: MapDto, count: 4 },
            token: reviewerToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id }),
              expect.objectContaining({ id: caMap.id }),
              expect.objectContaining({ id: privMap.id })
            ])
          );

          await prisma.mMap.update({
            where: { id: privMap.id },
            data: { submitter: { disconnect: true } }
          });
        });

        it('should filter by public maps when given the public filter', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            query: { filter: MapStatusNew.PUBLIC_TESTING },
            validatePaged: { type: MapDto, count: 2 },
            token: reviewerToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id })
            ])
          );
        });

        it('should filter by private maps when given the private filter', async () => {
          await prisma.mapTestingRequest.create({
            data: {
              mapID: privMap.id,
              userID: reviewer.id,
              state: MapTestingRequestState.ACCEPTED
            }
          });

          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            query: { filter: MapStatusNew.PRIVATE_TESTING },
            validatePaged: { type: MapDto, count: 1 },
            token: reviewerToken
          });

          expect(res.body.data[0]).toEqual(
            expect.objectContaining({ id: privMap.id })
          );
        });

        it('should filter by CONTENT_APPROVAL maps when given the CONTENT_APPROVAL filter', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            query: { filter: MapStatusNew.CONTENT_APPROVAL },
            validatePaged: { type: MapDto, count: 1 },
            token: reviewerToken
          });

          expect(res.body.data[0]).toEqual(
            expect.objectContaining({ id: caMap.id })
          );
        });

        // This is just because this endpoint is same for reviewer and admins.
        it('should 403 if given the FINAL_APPROVAL filter', async () => {
          await req.get({
            url: 'admin/maps/submissions',
            status: 403,
            query: { filter: MapStatusNew.FINAL_APPROVAL },
            token: reviewerToken
          });
        });
      });

      describe('Mod/Admin checks', () => {
        it('should respond with maps of all submission statuses by default for mods', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            validatePaged: { type: MapDto, count: 5 },
            token: modToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id }),
              expect.objectContaining({ id: privMap.id }),
              expect.objectContaining({ id: caMap.id }),
              expect.objectContaining({ id: faMap.id })
            ])
          );
        });

        // Role.ADMIN and Role.MODERATOR are treated exactly the same in code,
        // so just this should be sufficient to test
        it('should respond the same way for admins', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            validatePaged: { type: MapDto, count: 5 },
            token: adminToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id }),
              expect.objectContaining({ id: privMap.id }),
              expect.objectContaining({ id: caMap.id }),
              expect.objectContaining({ id: faMap.id })
            ])
          );
        });

        it('should filter by public maps when given the public filter', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            query: { filter: MapStatusNew.PUBLIC_TESTING },
            validatePaged: { type: MapDto, count: 2 },
            token: adminToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: pubMap1.id }),
              expect.objectContaining({ id: pubMap2.id })
            ])
          );
        });

        it('should filter by private maps when given the private filter', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            query: { filter: MapStatusNew.PRIVATE_TESTING },
            validatePaged: { type: MapDto, count: 1 },
            token: adminToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([
              expect.objectContaining({ id: privMap.id })
            ])
          );
        });

        it('should filter by CONTENT_APPROVAL maps when given the CONTENT_APPROVAL filter', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            query: { filter: MapStatusNew.CONTENT_APPROVAL },
            validatePaged: { type: MapDto, count: 1 },
            token: adminToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: caMap.id })])
          );
        });

        it('should filter by FINAL_APPROVAL maps when given the FINAL_APPROVAL filter', async () => {
          const res = await req.get({
            url: 'admin/maps/submissions',
            status: 200,
            query: { filter: MapStatusNew.FINAL_APPROVAL },
            validatePaged: { type: MapDto, count: 1 },
            token: adminToken
          });

          expect(res.body.data).toEqual(
            expect.arrayContaining([expect.objectContaining({ id: faMap.id })])
          );
        });
      });

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/maps/submissions', 'get'));
    });
  });

  describe('admin/maps/{mapID}', () => {
    describe('PATCH', () => {
      const bspBuffer = readFileSync(path.join(FILES_PATH, 'map.bsp'));
      const vmfBuffer = readFileSync(path.join(FILES_PATH, 'map.vmf'));

      let mod,
        modToken,
        admin,
        adminToken,
        reviewerToken,
        u1,
        u1Token,
        createMapData: Partial<Prisma.MMapCreateInput>;

      beforeAll(async () => {
        [[mod, modToken], [admin, adminToken], reviewerToken, [u1, u1Token]] =
          await Promise.all([
            db.createAndLoginUser({ data: { roles: Role.MODERATOR } }),
            db.createAndLoginUser({ data: { roles: Role.ADMIN } }),
            db.loginNewUser({ data: { roles: Role.REVIEWER } }),
            db.createAndLoginUser()
          ]);

        createMapData = {
          name: 'map',
          fileName: 'surf_map',
          submitter: { connect: { id: u1.id } },
          submission: {
            create: {
              type: MapSubmissionType.ORIGINAL,
              dates: [
                {
                  status: MapStatusNew.PRIVATE_TESTING,
                  date: new Date().toJSON()
                }
              ],
              suggestions: [
                {
                  gamemode: Gamemode.RJ,
                  trackType: TrackType.MAIN,
                  trackNum: 0,
                  tier: 1,
                  ranked: true
                }
              ],
              versions: {
                create: {
                  versionNum: 1,
                  hash: createSha1Hash(
                    'apple banana cat dog elephant fox grape hat igloo joker'
                  ),
                  zones: BabyZonesStub as unknown as JsonValue // TODO: #855
                }
              }
            }
          }
        };
      });

      afterAll(() => db.cleanup('leaderboardRun', 'user', 'adminActivity'));

      afterEach(() =>
        Promise.all([
          db.cleanup('mMap', 'adminActivity'),
          fileStore.deleteDirectory('maps'),
          fileStore.deleteDirectory('submissions')
        ])
      );

      for (const status of Enum.values(MapStatusNew)) {
        it(`should allow an admin to update map data during ${MapStatusNew[status]}`, async () => {
          const map = await db.createMap({ ...createMapData, status });

          await req.patch({
            url: `admin/maps/${map.id}`,
            status: 204,
            body: {
              fileName: 'surf_dogs',
              name: 'dogs',
              info: {
                description:
                  'Dogs are large flightless birds. They are the heaviest living birds, and lay the largest eggs of any living land animal.',
                youtubeID: 'Rt460jKi4Bk'
              },
              suggestions: [
                {
                  trackNum: 0,
                  trackType: TrackType.MAIN,
                  gamemode: Gamemode.CONC,
                  tier: 1,
                  ranked: true
                }
              ],
              placeholders: [{ type: MapCreditType.CONTRIBUTOR, alias: 'eee' }]
            },
            token: adminToken
          });

          const changedMap = await prisma.mMap.findFirst({
            where: { id: map.id },
            include: { info: true, submission: true }
          });

          expect(changedMap).toMatchObject({
            name: 'dogs',
            fileName: 'surf_dogs',
            info: {
              description:
                'Dogs are large flightless birds. They are the heaviest living birds, and lay the largest eggs of any living land animal.',
              youtubeID: 'Rt460jKi4Bk'
            },
            submission: {
              suggestions: [
                {
                  trackNum: 0,
                  trackType: TrackType.MAIN,
                  gamemode: Gamemode.CONC,
                  tier: 1,
                  ranked: true
                }
              ],
              placeholders: [{ type: MapCreditType.CONTRIBUTOR, alias: 'eee' }]
            }
          });
          expect(
            await adminActivityWasCreated(admin.id, [
              AdminActivityType.MAP_UPDATE
            ])
          ).toBe(true);
        });

        it(`should allow a mod to update map data during ${MapStatusNew[status]}`, async () => {
          const map = await db.createMap({ ...createMapData, status });

          await req.patch({
            url: `admin/maps/${map.id}`,
            status: 204,
            body: {
              fileName: 'surf_whelks',
              name: 'whelks',
              info: {
                description:
                  'Whelks are large flightless dogs. They are the heaviest living dogs, and lay the largest dogs of any living land animal.',
                youtubeID: 'IUfBBCkl_QI'
              },
              suggestions: [
                {
                  trackNum: 0,
                  trackType: TrackType.MAIN,
                  gamemode: Gamemode.BHOP,
                  tier: 1,
                  ranked: true
                }
              ],
              placeholders: [{ type: MapCreditType.CONTRIBUTOR, alias: 'eee' }]
            },
            token: modToken
          });

          const changedMap = await prisma.mMap.findFirst({
            where: { id: map.id },
            include: { info: true, submission: true }
          });

          expect(changedMap).toMatchObject({
            name: 'whelks',
            fileName: 'surf_whelks',
            info: {
              description:
                'Whelks are large flightless dogs. They are the heaviest living dogs, and lay the largest dogs of any living land animal.',
              youtubeID: 'IUfBBCkl_QI'
            },
            submission: {
              suggestions: [
                {
                  trackNum: 0,
                  trackType: TrackType.MAIN,
                  gamemode: Gamemode.BHOP,
                  tier: 1,
                  ranked: true
                }
              ],
              placeholders: [{ type: MapCreditType.CONTRIBUTOR, alias: 'eee' }]
            }
          });
          expect(
            await adminActivityWasCreated(mod.id, [
              AdminActivityType.MAP_UPDATE
            ])
          ).toBe(true);
        });

        it(`should not allow a reviewer to update map data during ${MapStatusNew[status]}`, async () => {
          const map = await db.createMap({ ...createMapData, status });

          await prisma.mMap.update({ where: { id: map.id }, data: { status } });

          await req.patch({
            url: `admin/maps/${map.id}`,
            status: 403,
            body: { fileName: 'surf_albatross' },
            token: reviewerToken
          });
        });
      }

      const statuses = Enum.values(MapStatusNew);
      //prettier-ignore
      const validChanges = new Set([
        `${MapStatusNew.APPROVED        },${MapStatusNew.DISABLED        },${Role.MODERATOR}`,
        `${MapStatusNew.APPROVED        },${MapStatusNew.DISABLED        },${Role.ADMIN}`,
        `${MapStatusNew.PRIVATE_TESTING },${MapStatusNew.DISABLED        },${Role.ADMIN}`,
        `${MapStatusNew.PRIVATE_TESTING },${MapStatusNew.DISABLED        },${Role.MODERATOR}`,
        `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.PUBLIC_TESTING  },${Role.ADMIN}`,
        `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.PUBLIC_TESTING  },${Role.MODERATOR}`,
        `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.PUBLIC_TESTING  },${Role.REVIEWER}`,
        `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.FINAL_APPROVAL  },${Role.MODERATOR}`,
        `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.FINAL_APPROVAL  },${Role.ADMIN}`,
        `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.DISABLED        },${Role.MODERATOR}`,
        `${MapStatusNew.CONTENT_APPROVAL},${MapStatusNew.DISABLED        },${Role.ADMIN}`,
        `${MapStatusNew.PUBLIC_TESTING  },${MapStatusNew.CONTENT_APPROVAL},${Role.MODERATOR}`,
        `${MapStatusNew.PUBLIC_TESTING  },${MapStatusNew.CONTENT_APPROVAL},${Role.ADMIN}`,
        `${MapStatusNew.PUBLIC_TESTING  },${MapStatusNew.DISABLED        },${Role.MODERATOR}`,
        `${MapStatusNew.PUBLIC_TESTING  },${MapStatusNew.DISABLED        },${Role.ADMIN}`,
        `${MapStatusNew.FINAL_APPROVAL  },${MapStatusNew.APPROVED        },${Role.MODERATOR}`,
        `${MapStatusNew.FINAL_APPROVAL  },${MapStatusNew.APPROVED        },${Role.ADMIN}`,
        `${MapStatusNew.FINAL_APPROVAL  },${MapStatusNew.DISABLED        },${Role.MODERATOR}`,
        `${MapStatusNew.FINAL_APPROVAL  },${MapStatusNew.DISABLED        },${Role.ADMIN}`,
        `${MapStatusNew.DISABLED        },${MapStatusNew.APPROVED        },${Role.ADMIN}`,
        `${MapStatusNew.DISABLED        },${MapStatusNew.PRIVATE_TESTING },${Role.ADMIN}`,
        `${MapStatusNew.DISABLED        },${MapStatusNew.CONTENT_APPROVAL},${Role.ADMIN}`,
        `${MapStatusNew.DISABLED        },${MapStatusNew.PUBLIC_TESTING  },${Role.ADMIN}`,
        `${MapStatusNew.DISABLED        },${MapStatusNew.FINAL_APPROVAL  },${Role.ADMIN}`
      ]);

      for (const s1 of statuses) {
        for (const s2 of statuses.filter((s) => s !== s1)) {
          for (const role of [Role.MODERATOR, Role.ADMIN, Role.REVIEWER]) {
            const shouldPass = validChanges.has(`${s1},${s2},${role}`);

            it(`should ${shouldPass ? '' : 'not '}allow a ${
              role === Role.ADMIN
                ? 'admin'
                : role === Role.MODERATOR
                  ? 'mod'
                  : 'reviewer'
            } to change a map from ${MapStatusNew[s1]} to ${
              MapStatusNew[s2]
            }`, async () => {
              const bspBuffer = readFileSync(path.join(FILES_PATH, 'map.bsp'));

              const map = await db.createMap({
                ...createMapData,
                submission: {
                  create: {
                    ...createMapData.submission.create,
                    versions: {
                      create: {
                        zones: BabyZonesStub,
                        versionNum: 1,
                        hash: createSha1Hash(bspBuffer)
                      }
                    }
                  }
                },
                status: s1
              });

              await prisma.mapSubmission.update({
                where: { mapID: map.id },
                data: { currentVersionID: map.submission.versions[0].id }
              });

              // Annoying to have to do this for every test but FA -> Approved
              // will throw otherwise.
              await fileStore.add(
                `submissions/${map.submission.versions[0].id}.bsp`,
                bspBuffer
              );

              await req.patch({
                url: `admin/maps/${map.id}`,
                status: shouldPass ? 204 : 403,
                body: {
                  status: s2,
                  finalLeaderboards:
                    s2 === MapStatusNew.APPROVED
                      ? [
                          {
                            gamemode: Gamemode.RJ,
                            trackNum: 0,
                            trackType: 0,
                            tier: 1,
                            ranked: false
                          }
                        ]
                      : undefined
                },
                token:
                  role === Role.ADMIN
                    ? adminToken
                    : role === Role.MODERATOR
                      ? modToken
                      : reviewerToken
              });

              if (shouldPass) {
                const updatedMap = await prisma.mMap.findUnique({
                  where: { id: map.id }
                });
                expect(updatedMap.status).toBe(s2);
              }
            });
          }
        }
      }

      it('should create placeholder users after map status changed from FA to approved', async () => {
        const bspBuffer = readFileSync(path.join(FILES_PATH, 'map.bsp'));

        const map = await db.createMap({
          ...createMapData,
          submission: {
            create: {
              ...createMapData.submission.create,
              versions: {
                create: {
                  versionNum: 1,
                  hash: createSha1Hash(bspBuffer),
                  zones: BabyZonesStub
                }
              },
              placeholders: [
                {
                  type: MapCreditType.CONTRIBUTOR,
                  alias: 'Bungus',
                  description: 'What'
                }
              ]
            }
          },
          status: MapStatusNew.FINAL_APPROVAL
        });

        await prisma.mapSubmission.update({
          where: { mapID: map.id },
          data: { currentVersionID: map.submission.versions[0].id }
        });

        await fileStore.add(
          `submissions/${map.submission.versions[0].id}.bsp`,
          bspBuffer
        );

        await req.patch({
          url: `admin/maps/${map.id}`,
          status: 204,
          body: {
            status: MapStatus.APPROVED,
            finalLeaderboards: [
              {
                gamemode: Gamemode.RJ,
                trackType: TrackType.MAIN,
                trackNum: 0,
                tier: 1,
                ranked: true
              }
            ]
          },
          token: adminToken
        });

        const bungus = await prisma.user.findFirst({
          where: { alias: 'Bungus' },
          include: { mapCredits: true }
        });

        expect(bungus).toMatchObject({
          mapCredits: [
            {
              mapID: map.id,
              type: MapCreditType.CONTRIBUTOR,
              description: 'What'
            }
          ]
        });
      });

      describe('Map Approval', () => {
        let map;
        const finalLeaderboards = [
          {
            gamemode: Gamemode.RJ,
            trackType: TrackType.MAIN,
            trackNum: 0,
            tier: 5,
            ranked: true
          },
          {
            gamemode: Gamemode.DEFRAG_CPM,
            trackType: TrackType.BONUS,
            trackNum: 0,
            tier: 10,
            ranked: false
          }
        ];

        // cleanup for this is done in outer afterEach
        beforeEach(async () => {
          map = await db.createMap({
            ...createMapData,
            submission: {
              create: {
                ...createMapData.submission.create,
                versions: {
                  create: {
                    versionNum: 1,
                    hash: createSha1Hash(bspBuffer),
                    zones: ZonesStub,
                    hasVmf: true
                  }
                }
              }
            },
            status: MapStatusNew.FINAL_APPROVAL
          });

          const vmfZip = new Zip();
          vmfZip.addFile('map.vmf', vmfBuffer);

          await fileStore.add(
            `submissions/${map.submission.versions[0].id}_VMFs.zip`,
            vmfZip.toBuffer()
          );

          await fileStore.add(
            `submissions/${map.submission.versions[0].id}.bsp`,
            bspBuffer
          );

          await prisma.leaderboard.createMany({
            data: ZonesStubLeaderboards.map((lb) => ({
              mapID: map.id,
              style: 0,
              ranked: false,
              ...lb
            }))
          });
        });

        it('should copy latest submission version files to maps/ after map status changed from FA to approved', async () => {
          const bspHash = createSha1Hash(bspBuffer);
          const vmfHash = createSha1Hash(vmfBuffer);

          await req.patch({
            url: `admin/maps/${map.id}`,
            status: 204,
            body: { status: MapStatus.APPROVED, finalLeaderboards },
            token: adminToken
          });

          const updatedMap = await prisma.mMap.findUnique({
            where: { id: map.id }
          });

          expect(updatedMap).toMatchObject({
            status: MapStatusNew.APPROVED,
            hash: bspHash,
            hasVmf: true
          });

          expect(
            await fileStore.exists(
              `submissions/${map.submission.versions[0].id}.bsp`
            )
          ).toBeFalsy();
          expect(
            await fileStore.exists(
              `submissions/${map.submission.versions[0].id}_VMFs.zip`
            )
          ).toBeFalsy();

          expect(
            createSha1Hash(await fileStore.get(`maps/${map.fileName}.bsp`))
          ).toBe(bspHash);

          expect(
            createSha1Hash(
              new Zip(await fileStore.get(`maps/${map.fileName}_VMFs.zip`))
                .getEntry('map.vmf')
                .getData()
            )
          ).toBe(vmfHash);
        });

        it('should create MAP_APPROVED activities for authors after map status changed from FA to approved', async () => {
          await prisma.mapCredit.createMany({
            data: [
              { type: MapCreditType.AUTHOR, mapID: map.id, userID: u1.id },
              { type: MapCreditType.AUTHOR, mapID: map.id, userID: admin.id },
              { type: MapCreditType.AUTHOR, mapID: map.id, userID: mod.id }
            ]
          });

          await req.patch({
            url: `admin/maps/${map.id}`,
            status: 204,
            body: { status: MapStatus.APPROVED, finalLeaderboards },
            token: adminToken
          });

          const mapApprovedActvities = await prisma.activity.findMany({
            where: { type: ActivityType.MAP_APPROVED, data: map.id }
          });

          expect(mapApprovedActvities).toHaveLength(3);
          expect(
            mapApprovedActvities.map((activity) => activity.userID).sort()
          ).toEqual([u1.id, admin.id, mod.id].sort());
        });

        it('should create leaderboards based on finalLeaderboards and clear all existing', async () => {
          await db.createLbRun({
            map,
            user: u1,
            rank: 1,
            gamemode: Gamemode.RJ,
            trackType: TrackType.MAIN,
            trackNum: 0
          });

          await db.createLbRun({
            map,
            user: u1,
            rank: 1,
            gamemode: Gamemode.CONC,
            trackType: TrackType.MAIN,
            trackNum: 0
          });

          expect(
            await prisma.leaderboardRun.findMany({
              where: { mapID: map.id, gamemode: Gamemode.RJ }
            })
          ).toHaveLength(1);

          expect(
            await prisma.leaderboardRun.findMany({
              where: { mapID: map.id, gamemode: Gamemode.CONC }
            })
          ).toHaveLength(1);

          await req.patch({
            url: `admin/maps/${map.id}`,
            status: 204,
            body: { status: MapStatus.APPROVED, finalLeaderboards },
            token: adminToken
          });

          const leaderboards = await prisma.leaderboard.findMany({
            where: { mapID: map.id }
          });
          expect(leaderboards).toEqual(
            expect.arrayContaining([
              {
                mapID: map.id,
                gamemode: Gamemode.RJ,
                trackType: TrackType.MAIN,
                trackNum: 0,
                linear: false,
                style: 0,
                tier: 5,
                ranked: true,
                tags: []
              },
              {
                mapID: map.id,
                gamemode: Gamemode.RJ,
                trackType: TrackType.STAGE,
                trackNum: 0,
                linear: null,
                tier: null,
                ranked: true,
                style: 0,
                tags: []
              },
              {
                mapID: map.id,
                gamemode: Gamemode.RJ,
                trackType: TrackType.STAGE,
                trackNum: 1,
                linear: null,
                tier: null,
                ranked: true,
                style: 0,
                tags: []
              },
              {
                mapID: map.id,
                gamemode: Gamemode.DEFRAG_CPM,
                trackType: TrackType.BONUS,
                trackNum: 0,
                linear: null,
                tier: 10,
                ranked: false,
                style: 0,
                tags: []
              }
            ])
          );

          expect(leaderboards).toHaveLength(4);

          expect(
            await prisma.leaderboardRun.findMany({
              where: { mapID: map.id, gamemode: Gamemode.RJ }
            })
          ).toHaveLength(0);

          expect(
            await prisma.leaderboardRun.findMany({
              where: { mapID: map.id, gamemode: Gamemode.CONC }
            })
          ).toHaveLength(0);
        });

        it('should 400 when moving from FA to approved if leaderboards are not provided', async () => {
          await req.patch({
            url: `admin/maps/${map.id}`,
            status: 400,
            body: { status: MapStatus.APPROVED },
            token: adminToken
          });
        });
      });

      it('should return 404 if map not found', () =>
        req.patch({
          url: `admin/maps/${NULL_ID}`,
          status: 404,
          body: { status: MapStatus.PUBLIC_TESTING },
          token: adminToken
        }));

      it('should return 403 for a non-admin/mod/reviewer access token is given', () =>
        req.patch({
          url: `admin/maps/${NULL_ID}`,
          status: 403,
          token: u1Token
        }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/maps/1', 'patch'));
    });

    describe('DELETE', () => {
      let modToken, admin, adminToken, u1, u1Token, m1;

      beforeAll(async () => {
        [modToken, [admin, adminToken], [u1, u1Token]] = await Promise.all([
          db.loginNewUser({ data: { roles: Role.MODERATOR } }),
          db.createAndLoginUser({ data: { roles: Role.ADMIN } }),
          db.createAndLoginUser({ data: { roles: Role.MAPPER } })
        ]);
      });

      afterAll(() =>
        db.cleanup('leaderboardRun', 'user', 'mMap', 'adminActivity')
      );

      beforeEach(async () => {
        m1 = await db.createMap({
          submitter: { connect: { id: u1.id } },
          images: { create: {} }
        });
        await db.createLbRun({ map: m1, user: u1, time: 1, rank: 1 });
      });

      afterEach(() => db.cleanup('mMap'));

      it('should successfully delete the map and related stored data', async () => {
        const fileName = 'my_cool_map';
        await prisma.mMap.update({ where: { id: m1.id }, data: { fileName } });

        await fileStore.add(
          `maps/${fileName}.bsp`,
          readFileSync(__dirname + '/../files/map.bsp')
        );

        const img = await prisma.mapImage.findFirst({
          where: { mapID: m1.id }
        });
        for (const size of ['small', 'medium', 'large']) {
          await fileStore.add(
            `img/${img.id}-${size}.jpg`,
            readFileSync(__dirname + '/../files/image_jpg.jpg')
          );
        }

        const run = await prisma.leaderboardRun.findFirst({
          where: { mapID: m1.id }
        });
        await fileStore.add(runPath(run.replayHash), Buffer.alloc(123));

        await req.del({
          url: `admin/maps/${m1.id}`,
          status: 204,
          token: adminToken
        });

        expect(
          await prisma.mMap.findFirst({ where: { id: m1.id } })
        ).toBeNull();
        expect(await fileStore.exists(`maps/${fileName}.bsp`)).toBeFalsy();

        const relatedRuns = await prisma.leaderboardRun.findMany({
          where: { mapID: m1.id }
        });
        expect(relatedRuns).toHaveLength(0);
        expect(await fileStore.exists(runPath(run.replayHash))).toBeFalsy();

        const relatedImages = await prisma.mapImage.findMany({
          where: { mapID: m1.id }
        });
        expect(relatedImages).toHaveLength(0);
        for (const size of ['small', 'medium', 'large']) {
          expect(
            await fileStore.exists(`img/${img.id}-${size}.jpg`)
          ).toBeFalsy();
        }
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.MAP_DELETE
          ])
        ).toBe(true);
      });

      it('should return 404 if map not found', () =>
        req.del({
          url: `admin/maps/${NULL_ID}`,
          status: 404,
          token: adminToken
        }));

      it('should return 403 if a non admin access token is given', () =>
        req.del({
          url: `admin/maps/${m1.id}`,
          status: 403,
          token: u1Token
        }));

      it('should return 403 if a mod access token is given', () =>
        req.del({
          url: `admin/maps/${m1.id}`,
          status: 403,
          token: modToken
        }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/maps/1', 'del'));
    });
  });

  describe('admin/reports', () => {
    describe('GET', () => {
      let adminToken, u1, u1Token, r1, _r2;

      beforeAll(async () => {
        [adminToken, [u1, u1Token]] = await Promise.all([
          db.loginNewUser({ data: { roles: Role.ADMIN } }),
          db.createAndLoginUser()
        ]);

        r1 = await prisma.report.create({
          data: {
            data: 1,
            type: ReportType.MAP_REPORT,
            category: ReportCategory.INAPPROPRIATE_CONTENT,
            message: 'report message',
            resolved: false,
            resolutionMessage: '',
            submitterID: u1.id
          }
        });

        _r2 = await prisma.report.create({
          data: {
            data: 2,
            type: ReportType.USER_PROFILE_REPORT,
            category: ReportCategory.PLAGIARISM,
            message: 'report2 message',
            resolved: true,
            resolutionMessage: '2',
            submitterID: u1.id
          }
        });
      });

      afterAll(() => db.cleanup('user', 'report'));

      it('should return a list of reports', async () => {
        const reports = await req.get({
          url: 'admin/reports',
          status: 200,
          token: adminToken,
          validatePaged: { type: ReportDto, count: 2 }
        });
        expect(reports.body).toHaveProperty('data');
        expect(reports.body.data[0].data).toBe(Number(r1.data));
        expect(reports.body.data[0].type).toBe(r1.type);
        expect(reports.body.data[0].category).toBe(r1.category);
        expect(reports.body.data[0].message).toBe(r1.message);
        expect(reports.body.data[0].resolved).toBe(r1.resolved);
        expect(reports.body.data[0].resolutionMessage).toBe(
          r1.resolutionMessage
        );
        expect(reports.body.data[0].submitterID).toBe(r1.submitterID);
      });

      it('should only return resolved or non resolved based on query param resolved', async () => {
        const reportsResolved = await req.get({
          url: 'admin/reports',
          status: 200,
          query: { resolved: true },
          token: adminToken,
          validatePaged: { type: ReportDto, count: 1 }
        });

        expect(reportsResolved.body.data[0].resolved).toBe(true);

        const reportsNonResolved = await req.get({
          url: 'admin/reports',
          status: 200,
          query: { resolved: false },
          token: adminToken,
          validatePaged: { type: ReportDto, count: 1 }
        });

        expect(reportsNonResolved.body.data[0].resolved).toBe(false);
      });

      it('should limit the result set when using the take query param', () =>
        req.takeTest({
          url: 'admin/reports',
          validate: ReportDto,
          token: adminToken
        }));

      it('should skip some of the result set when using the skip query param', () =>
        req.skipTest({
          url: 'admin/reports',
          validate: ReportDto,
          token: adminToken
        }));

      it('should return a list of reports with the submitter include', () =>
        req.expandTest({
          url: 'admin/reports',
          validate: ReportDto,
          expand: 'submitter',
          paged: true,
          token: adminToken
        }));

      it('should return a list of reports with the resolver include', () =>
        req.expandTest({
          url: 'admin/reports',
          validate: ReportDto,
          expand: 'submitter',
          paged: true,
          token: adminToken
        }));

      it('should return 403 if a non admin access token is given', () =>
        req.get({
          url: 'admin/reports',
          status: 403,
          token: u1Token
        }));

      it('should 401 when no access token is provided', () =>
        req.unauthorizedTest('admin/reports', 'get'));
    });
  });

  describe('admin/reports/{reportID}', () => {
    describe('PATCH', () => {
      let admin, adminToken, u1, u1Token, r1, _r2;

      beforeEach(async () => {
        [[admin, adminToken], [u1, u1Token]] = await Promise.all([
          db.createAndLoginUser({
            data: { roles: Role.ADMIN }
          }),
          db.createAndLoginUser()
        ]);

        r1 = await prisma.report.create({
          data: {
            data: 1,
            type: ReportType.MAP_REPORT,
            category: ReportCategory.INAPPROPRIATE_CONTENT,
            message: 'report message',
            resolved: false,
            resolutionMessage: '',
            submitterID: u1.id
          }
        });

        _r2 = await prisma.report.create({
          data: {
            data: 2,
            type: ReportType.USER_PROFILE_REPORT,
            category: ReportCategory.PLAGIARISM,
            message: 'report2 message',
            resolved: true,
            resolutionMessage: '2',
            submitterID: u1.id
          }
        });
      });

      afterEach(() => db.cleanup('user', 'report', 'adminActivity'));

      it('should edit a report', async () => {
        await req.patch({
          url: `admin/reports/${r1.id}`,
          status: 204,
          body: { resolved: true, resolutionMessage: 'resolved' },
          token: adminToken
        });

        const changedReport = await prisma.report.findFirst({
          where: { id: r1.id }
        });

        expect(changedReport.resolved).toBe(true);
        expect(changedReport.resolutionMessage).toBe('resolved');
        expect(changedReport.resolverID).toBe(admin.id);
        expect(
          await adminActivityWasCreated(admin.id, [
            AdminActivityType.REPORT_RESOLVE
          ])
        ).toBe(true);
      });

      it('should return 404 if targeting a nonexistent report', () =>
        req.patch({
          url: `admin/reports/${NULL_ID}`,
          status: 404,
          body: { resolved: true, resolutionMessage: 'resolved' },
          token: adminToken
        }));

      it('should return 403 if a non admin access token is given', () =>
        req.patch({
          url: `admin/reports/${r1.id}`,
          status: 403,
          token: u1Token
        }));

      it('should return 401 if no access token is given', () =>
        req.patch({ url: `admin/reports/${r1.id}`, status: 401 }));
    });
  });

  describe('admin/activities', () => {
    describe('GET', () => {
      let admin, adminToken, mod, u1, u1Token;
      beforeAll(async () => {
        [[admin, adminToken], mod, [u1, u1Token]] = await Promise.all([
          db.createAndLoginUser({ data: { roles: Role.ADMIN } }),
          db.createUser({ data: { roles: Role.MODERATOR } }),
          db.createAndLoginUser()
        ]);

        // Seperate creates for different createdAt
        await prisma.adminActivity.create({
          data: {
            type: AdminActivityType.MAP_UPDATE,
            target: 1,
            oldData: {},
            newData: { someData: 'yes' },
            user: { connect: { id: admin.id } }
          }
        });
        await prisma.adminActivity.create({
          data: {
            type: AdminActivityType.USER_UPDATE_ALIAS,
            target: u1.id,
            oldData: {},
            newData: { profile: { alias: 'yes' } },
            user: { connect: { id: mod.id } }
          }
        });
        await prisma.adminActivity.create({
          data: {
            type: AdminActivityType.USER_UPDATE_BIO,
            target: u1.id,
            oldData: {},
            newData: { profile: { bio: 'yes' } },
            user: { connect: { id: admin.id } }
          }
        });
      });

      afterAll(() => db.cleanup('user', 'adminActivity'));

      it('should return a list of all sorted admin activities', async () => {
        const adminActivities = await req.get({
          url: 'admin/activities',
          status: 200,
          token: adminToken,
          validatePaged: { type: AdminActivityDto, count: 3 }
        });

        expect(adminActivities.body).toHaveProperty('data');

        expect(adminActivities.body.data[0].type).toEqual(
          AdminActivityType.USER_UPDATE_BIO
        );
        expect(adminActivities.body.data[1].type).toEqual(
          AdminActivityType.USER_UPDATE_ALIAS
        );
      });

      it('should return a filtered list of all admin activities', async () => {
        const adminActivities = await req.get({
          url: 'admin/activities',
          status: 200,
          token: adminToken,
          query: {
            filter: `${AdminActivityType.MAP_UPDATE},${AdminActivityType.USER_UPDATE_BIO}`
          },
          validatePaged: { type: AdminActivityDto, count: 2 }
        });

        expect(adminActivities.body).toHaveProperty('data');

        expect(adminActivities.body.data[0].type).toEqual(
          AdminActivityType.USER_UPDATE_BIO
        );
        expect(adminActivities.body.data[1].type).toEqual(
          AdminActivityType.MAP_UPDATE
        );
      });

      it('should 403 when the user tries to get admin activities', () =>
        req.get({
          url: 'admin/activities',
          status: 403,
          token: u1Token
        }));

      it('should 403 when no access token is provided', () =>
        req.unauthorizedTest('admin/activities', 'get'));
    });
  });

  describe('admin/activities/{adminID}', () => {
    describe('GET', () => {
      let admin, adminToken, u1, u1Token;
      beforeAll(async () => {
        [[admin, adminToken], [u1, u1Token]] = await Promise.all([
          db.createAndLoginUser({ data: { roles: Role.ADMIN } }),
          db.createAndLoginUser()
        ]);
      });

      afterAll(() => db.cleanup('user', 'adminActivity'));

      it('should return a list of admin activities', async () => {
        const oldUser = await prisma.user.findUnique({
          where: { id: u1.id },
          include: { profile: true }
        });

        await req.patch({
          url: `admin/users/${u1.id}`,
          status: 204,
          body: { alias: 'Update Alias' },
          token: adminToken
        });

        const newUser = await prisma.user.findUnique({
          where: { id: u1.id },
          include: { profile: true }
        });

        const adminActivities = await req.get({
          url: 'admin/activities/' + admin.id,
          status: 200,
          token: adminToken,
          validatePaged: { type: AdminActivityDto, count: 1 }
        });

        expect(adminActivities.body).toHaveProperty('data');

        const userUpdateActivity = adminActivities.body.data.find(
          (activity) => activity.type == AdminActivityType.USER_UPDATE_ALIAS
        );

        expect(userUpdateActivity.oldData).toEqual(
          JSON.parse(JSON.stringify(oldUser)) // To convert object to format from the request (For example: convert dates and bigints to strings)
        );
        expect(userUpdateActivity.newData).toEqual(
          JSON.parse(JSON.stringify(newUser))
        );
        expect(userUpdateActivity.target).toBe(oldUser.id.toString());
      });

      it('should 403 when the user tries to get admin activities', () =>
        req.get({
          url: 'admin/activities/' + admin.id,
          status: 403,
          token: u1Token
        }));

      it('should 403 when no access token is provided', () =>
        req.unauthorizedTest('admin/activities/' + admin.id, 'get'));
    });
  });
});
