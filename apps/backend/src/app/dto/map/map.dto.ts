import {
  approvedBspPath,
  approvedVmfsPath,
  CreateMap,
  CreateMapWithFiles,
  MapStatusNew,
  MapSubmissionType,
  MAX_MAP_NAME_LENGTH,
  MIN_MAP_NAME_LENGTH,
  MMap,
  UpdateMap,
  UpdateMapAdmin
} from '@momentum/constants';
import { ApiProperty, OmitType, PartialType, PickType } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsHash,
  IsInt,
  IsLowercase,
  IsOptional,
  IsPositive,
  IsString,
  IsUrl,
  MaxLength,
  MinLength
} from 'class-validator';
import { Exclude, Expose } from 'class-transformer';
import { UserDto } from '../user/user.dto';
import { Config } from '../../config';
import {
  CreatedAtProperty,
  EnumProperty,
  IdProperty,
  NestedProperty,
  UpdatedAtProperty
} from '../decorators';
import { IsMapName } from '../../validators';
import { LeaderboardDto } from '../run/leaderboard.dto';
import { LeaderboardRunDto } from '../run/leaderboard-run.dto';
import { MapImageDto } from './map-image.dto';
import { CreateMapInfoDto, MapInfoDto, UpdateMapInfoDto } from './map-info.dto';
import { CreateMapCreditDto, MapCreditDto } from './map-credit.dto';
import { MapFavoriteDto } from './map-favorite.dto';
import { MapLibraryEntryDto } from './map-library-entry';
import { MapStatsDto } from './map-stats.dto';
import { MapSubmissionDto } from './map-submission.dto';
import { MapSubmissionSuggestionDto } from './map-submission-suggestion.dto';
import { MapSubmissionPlaceholderDto } from './map-submission-placeholder.dto';
import { MapZonesDto } from './map-zones.dto';
import { MapSubmissionApprovalDto } from './map-submission-approval.dto';

const ENDPOINT_URL = Config.storage.endpointUrl;
const BUCKET = Config.storage.bucketName;

export class MapDto implements MMap {
  @IdProperty()
  readonly id: number;

  @ApiProperty({
    type: String,
    description:
      'The name of the map without any extra embellishments e.g. "_final"',
    example: 'arcane'
  })
  @MinLength(MIN_MAP_NAME_LENGTH)
  @MaxLength(MAX_MAP_NAME_LENGTH)
  @IsLowercase()
  readonly name: string;

  @ApiProperty({
    type: String,
    description: 'The full filename of the map',
    example: 'bhop_arcane'
  })
  @IsMapName()
  @MinLength(MIN_MAP_NAME_LENGTH)
  @MaxLength(MAX_MAP_NAME_LENGTH)
  readonly fileName: string;

  @EnumProperty(MapStatusNew)
  readonly status: MapStatusNew;

  @NestedProperty(MapZonesDto, {
    required: false,
    description: 'Zones for the map'
  })
  readonly zones: MapZonesDto;

  @ApiProperty({ type: String, description: 'URL to BSP in storage' })
  @Expose()
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  get downloadURL() {
    return this.status === MapStatusNew.APPROVED
      ? `${ENDPOINT_URL}/${BUCKET}/${approvedBspPath(this.fileName)}`
      : undefined;
  }

  @ApiProperty({ description: 'SHA1 hash of the BSP file', type: String })
  @IsHash('sha1')
  @IsOptional()
  readonly hash: string;

  @ApiProperty({ type: String, description: 'URL to VMF in storage' })
  @Expose()
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  get vmfDownloadURL() {
    return this.status === MapStatusNew.APPROVED && this.hasVmf
      ? `${ENDPOINT_URL}/${BUCKET}/${approvedVmfsPath(this.fileName)}`
      : undefined;
  }

  @Exclude()
  readonly hasVmf: boolean;

  @Exclude()
  readonly thumbnailID: number;

  @NestedProperty(MapImageDto)
  readonly thumbnail: MapImageDto;

  @ApiProperty()
  @IsPositive()
  @IsOptional()
  readonly submitterID: number;

  @NestedProperty(MapInfoDto)
  readonly info: MapInfoDto;

  @NestedProperty(UserDto, {
    lazy: true,
    description: 'The user the submitted the map'
  })
  readonly submitter: UserDto;

  @NestedProperty(MapSubmissionDto)
  readonly submission: MapSubmissionDto;

  @NestedProperty(MapImageDto, { isArray: true })
  readonly images: MapImageDto[];

  @NestedProperty(MapStatsDto)
  readonly stats: MapStatsDto;

  @NestedProperty(MapCreditDto, { isArray: true })
  readonly credits: MapCreditDto[];

  @NestedProperty(MapFavoriteDto, { isArray: true })
  readonly favorites: MapFavoriteDto[];

  @NestedProperty(MapLibraryEntryDto, { isArray: true })
  readonly libraryEntries: MapLibraryEntryDto[];

  @NestedProperty(LeaderboardDto, { isArray: true })
  readonly leaderboards: LeaderboardDto[];

  @NestedProperty(LeaderboardRunDto, { lazy: true, isArray: true })
  readonly worldRecords: LeaderboardRunDto[];

  @NestedProperty(LeaderboardRunDto, { lazy: true, isArray: true })
  readonly personalBests: LeaderboardRunDto[];

  @CreatedAtProperty()
  readonly createdAt: Date;

  @UpdatedAtProperty()
  readonly updatedAt: Date;
}

export class CreateMapDto
  extends PickType(MapDto, ['name', 'fileName'] as const)
  implements CreateMap
{
  @EnumProperty(MapSubmissionType, {
    description:
      'Whether the submission is an original map, a port, or something unusual'
  })
  readonly submissionType: MapSubmissionType;

  @NestedProperty(MapSubmissionSuggestionDto, { required: true, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  readonly suggestions: MapSubmissionSuggestionDto[];

  @ApiProperty({
    description: 'Whether the map should go into private testing'
  })
  @IsBoolean()
  readonly wantsPrivateTesting: boolean;

  @ApiProperty({
    description: 'Aliases for which new placeholder users should be made'
  })
  @NestedProperty(MapSubmissionPlaceholderDto, {
    description: 'Aliases for which new placeholder users should be made',
    isArray: true
  })
  @IsArray()
  @IsOptional()
  readonly placeholders: MapSubmissionPlaceholderDto[];

  @ApiProperty({
    description: 'Array of user IDs to invite to private testing',
    isArray: true
  })
  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  readonly testInvites?: number[];

  @NestedProperty(CreateMapInfoDto, { required: true })
  readonly info: CreateMapInfoDto;

  @NestedProperty(MapZonesDto, {
    required: true,
    description: 'The contents of the map zone file as JSON'
  })
  readonly zones: MapZonesDto;

  @NestedProperty(CreateMapCreditDto, { required: true, isArray: true })
  @IsArray()
  @IsOptional()
  readonly credits: CreateMapCreditDto[];
}

export class CreateMapWithFilesDto implements CreateMapWithFiles {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description: 'BSP for the map. MUST be run through bspzip!'
  })
  @IsDefined()
  readonly bsp: any;

  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'VMFs for the map. Usually a single file, but takes an array to allow instances.'
  })
  @IsOptional()
  readonly vmfs: any[];

  @NestedProperty(CreateMapDto, {
    description: 'The JSON part of the body'
  })
  readonly data: CreateMapDto;
}

export class UpdateMapDto
  extends PartialType(
    PickType(CreateMapDto, ['name', 'fileName', 'suggestions'] as const)
  )
  implements UpdateMap
{
  @NestedProperty(MapSubmissionPlaceholderDto)
  readonly placeholders: MapSubmissionPlaceholderDto[];

  @NestedProperty(UpdateMapInfoDto)
  @IsOptional()
  readonly info: UpdateMapInfoDto;

  @EnumProperty(MapStatusNew)
  @IsOptional()
  readonly status: MapStatusNew.CONTENT_APPROVAL | MapStatusNew.FINAL_APPROVAL;

  @ApiProperty({ description: 'Clear the existing leaderboards' })
  @IsBoolean()
  @IsOptional()
  readonly resetLeaderboards?: boolean;
}

export class UpdateMapAdminDto
  extends OmitType(UpdateMapDto, ['status'] as const)
  implements UpdateMapAdmin
{
  @EnumProperty(MapStatusNew)
  @IsOptional()
  readonly status: MapStatusNew;

  @ApiProperty({ description: 'UserID to update the submitter to' })
  @IsPositive()
  @IsOptional()
  readonly submitterID: number;

  @NestedProperty(MapZonesDto, {
    required: false,
    description: 'Zones for the map'
  })
  readonly zones: MapZonesDto;

  @NestedProperty(MapSubmissionApprovalDto, { required: false, isArray: true })
  @ArrayMinSize(1)
  finalLeaderboards?: MapSubmissionApprovalDto[];
}
