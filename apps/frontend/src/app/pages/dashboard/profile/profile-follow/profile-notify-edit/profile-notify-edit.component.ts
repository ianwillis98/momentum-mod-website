import { Component, Input, OnInit } from '@angular/core';
import { ActivityType } from '@momentum/constants';
import { NbDialogRef } from '@nebular/theme';

@Component({
  selector: 'mom-profile-notify-edit-modal',
  templateUrl: './profile-notify-edit.component.html',
  styleUrls: ['./profile-notify-edit.component.scss']
})
export class ProfileNotifyEditComponent implements OnInit {
  @Input() flags: number;
  protected readonly ActivityType = ActivityType;
  checkboxFlags = {
    pb: { checked: false, value: ActivityType.PB_ACHIEVED },
    wr: { checked: false, value: ActivityType.WR_ACHIEVED },
    approved: { checked: false, value: ActivityType.MAP_APPROVED },
    uploaded: { checked: false, value: ActivityType.MAP_UPLOADED }
  };

  constructor(protected dialogRef: NbDialogRef<ProfileNotifyEditComponent>) {}

  ngOnInit() {
    for (const perm in this.checkboxFlags) {
      if ((1 << this.checkboxFlags[perm].value) & this.flags) {
        this.checkboxFlags[perm].checked = true;
      }
    }
  }

  close() {
    this.dialogRef.close();
  }

  submit() {
    for (const perm in this.checkboxFlags) {
      if (this.checkboxFlags[perm].checked) {
        this.flags |= 1 << this.checkboxFlags[perm].value;
      } else this.flags &= ~(1 << this.checkboxFlags[perm].value);
    }
    this.dialogRef.close({ newFlags: this.flags });
  }
}
