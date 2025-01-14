import { Component, OnDestroy, OnInit } from '@angular/core';
import { finalize, switchMap, takeUntil } from 'rxjs/operators';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import {
  CdkDrag,
  CdkDragDrop,
  CdkDropList,
  moveItemInArray
} from '@angular/cdk/drag-drop';
import { Subject } from 'rxjs';
import { MMap, MapImage, MapCreditType, Role } from '@momentum/constants';
import { MessageService } from 'primeng/api';
import { DialogService } from 'primeng/dynamicdialog';
import { TabViewModule } from 'primeng/tabview';
import {
  ConfirmDialogComponent,
  EditableMapCredit,
  SortedMapCredits,
  FileUploadComponent
} from '../../../components';
import { AdminService, LocalUserService, MapsService } from '../../../services';
import { SharedModule } from '../../../shared.module';
import { MapCreditsComponent } from '../map-credits/map-credits.component';
import { PluralPipe } from '../../../pipes';

const youtubeRegex = /[\w-]{11}/;

@Component({
  selector: 'm-map-edit',
  templateUrl: './map-edit.component.html',
  styleUrls: ['./map-edit.component.css'],
  standalone: true,
  imports: [
    SharedModule,
    CdkDrag,
    CdkDropList,
    MapCreditsComponent,
    FileUploadComponent,
    TabViewModule,
    PluralPipe
  ]
})
export class MapEditComponent implements OnInit, OnDestroy {
  private ngUnsub = new Subject<void>();
  map: MMap;
  images: MapImage[] = [];
  readonly imagesLimit = 6; // TODO: use @momentum/constants
  credits = new SortedMapCredits();
  isSubmitter: boolean;
  isAdmin: boolean;
  isModerator: boolean;

  // TODO: `: FormGroup` actually makes this a WEAKER type, removing it causes, you guessed it, a type error!
  infoForm: FormGroup = this.fb.group({
    youtubeID: ['', [Validators.pattern(youtubeRegex)]],
    description: ['', [Validators.maxLength(1000)]]
  });

  creditsForm: FormGroup = this.fb.group({
    authors: [[], Validators.required]
  });

  adminForm: FormGroup = this.fb.group({});

  get youtubeID() {
    return this.infoForm.get('youtubeID');
  }

  get description() {
    return this.infoForm.get('description');
  }

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly mapService: MapsService,
    private readonly localUserService: LocalUserService,
    private readonly adminService: AdminService,
    private readonly dialogService: DialogService,
    private readonly messageService: MessageService,
    private readonly fb: FormBuilder
  ) {}

  ngOnInit() {
    this.route.paramMap
      .pipe(
        switchMap((params: ParamMap) =>
          this.mapService.getMap(Number(params.get('id')), {
            expand: ['info', 'credits', 'images']
          })
        )
      )
      .subscribe((map: MMap) => {
        // TODO: Reduce nesting?
        this.map = map;
        this.localUserService.localUserSubject
          .pipe(takeUntil(this.ngUnsub))
          .subscribe((localUser) => {
            this.isAdmin = this.localUserService.hasRole(Role.ADMIN, localUser);
            this.isModerator = this.localUserService.hasRole(
              Role.MODERATOR,
              localUser
            );
            this.isSubmitter = this.map.submitterID === localUser.id;

            if (!(this.isSubmitter || this.isAdmin || this.isModerator))
              this.router.navigate(['/maps' + this.map.id]);

            this.infoForm.patchValue(map.info);
            this.images = map.images;

            this.credits.set(map.credits as EditableMapCredit[]);

            this.creditsForm
              .get('authors')
              .patchValue(this.credits[MapCreditType.AUTHOR]);
          });
      });
  }

  onInfoSubmit() {
    if (this.infoForm.invalid) return;
    if (this.youtubeID.value != null) {
      const youtubeIDMatch = this.youtubeID.value.match(youtubeRegex);
      this.youtubeID.patchValue(youtubeIDMatch ? youtubeIDMatch[0] : null);
    }
    this.mapService.updateMapInfo(this.map.id, this.infoForm.value).subscribe({
      next: () =>
        this.messageService.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Updated the map!'
        }),
      error: (error) =>
        this.messageService.add({
          severity: 'error',
          summary: error.message,
          detail: 'Failed to update the map!'
        })
    });
  }

  onImagesSubmit() {
    // TODO: Submit changed images
  }

  onCreditsSubmit($event: Event) {
    if (this.creditsForm.invalid) return;

    const saveButton = $event.target as HTMLButtonElement;
    saveButton.disabled = true;

    this.mapService
      .updateMapCredits(this.map.id, this.credits.getSubmittableRealUsers())
      .pipe(finalize(() => (saveButton.disabled = false)))
      .subscribe({
        next: (credits) => {
          this.credits.set(credits as EditableMapCredit[]);
          this.messageService.add({
            severity: 'success',
            detail: 'Updated map credits!'
          });
        },
        error: (error) =>
          this.messageService.add({
            severity: 'error',
            summary: 'Failed to update credits!',
            detail: error.message
          })
      });
  }

  getImageSource(
    img: File,
    callback: (result: any, originalFile: File) => void
  ) {
    let reader = new FileReader();
    const handler = (e) => {
      callback(e.target.result, img);
      reader.removeEventListener('load', handler, false);
      reader = null;
    };
    reader.addEventListener('load', handler, false);
    reader.readAsDataURL(img);
  }

  onMapImageSelected() {
    // this.getImageSource(file[0], (blobURL) => {
    //   if (this.images.length >= this.imagesLimit) return;
    //   // ????????? what
    //   this.images.push({
    //     id: -1,
    //     mapID: -1,
    //     small: blobURL,
    //     medium: '',
    //     large: ''
    //     // file: img,
    //   });
    // });
  }

  removeMapImage(img: MapImage) {
    this.images.splice(this.images.indexOf(img), 1);
  }

  imageDrop(event: CdkDragDrop<MapImage[]>) {
    moveItemInArray(this.images, event.previousIndex, event.currentIndex);
  }

  onCreditChanged() {
    console.log('credits changed!', { credits: this.credits });
    this.creditsForm
      .get('authors')
      .patchValue(this.credits[MapCreditType.AUTHOR]);
  }

  showMapDeleteDialog() {
    this.dialogService
      .open(ConfirmDialogComponent, {
        header: 'Are you sure?',
        data: {
          message:
            'You are about to permanently delete this map. Are you sure you want to proceed?'
        }
      })
      .onClose.subscribe((response) => {
        if (!response) return;
        this.adminService.deleteMap(this.map.id).subscribe({
          next: () =>
            this.messageService.add({
              severity: 'success',
              detail: 'Successfully deleted the map'
            }),
          error: (error) =>
            this.messageService.add({
              severity: 'error',
              summary: 'Failed to delete the map',
              detail: error.message
            })
        });
      });
  }

  ngOnDestroy(): void {
    this.ngUnsub.next();
    this.ngUnsub.complete();
  }
}
