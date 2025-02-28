import {
  ControlValueAccessor,
  NG_VALUE_ACCESSOR,
  FormsModule
} from '@angular/forms';
import { Component, forwardRef, QueryList, ViewChildren } from '@angular/core';
import {
  MapCreditNames,
  MapCreditType,
  STEAM_MISSING_AVATAR_URL,
  User
} from '@momentum/constants';
import {
  CdkDragDrop,
  moveItemInArray,
  transferArrayItem,
  CdkDropList,
  CdkDrag
} from '@angular/cdk/drag-drop';
import { Enum } from '@momentum/enum';
import { KeyValuePipe } from '@angular/common';
import { UserSearchComponent } from '../search/user-search/user-search.component';
import { IconComponent } from '../../icons';
import { TooltipDirective } from '../../directives';
import { AvatarComponent } from '../avatar/avatar.component';
import { SortedMapCredits } from './sorted-map-credits.class';

@Component({
  selector: 'm-map-credits-selection',
  templateUrl: 'map-credits-selection.component.html',
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MapCreditsSelectionComponent),
      multi: true
    }
  ],
  standalone: true,
  imports: [
    CdkDropList,
    CdkDrag,
    IconComponent,
    FormsModule,
    UserSearchComponent,
    KeyValuePipe,
    TooltipDirective,
    AvatarComponent
  ]
})
export class MapCreditsSelectionComponent implements ControlValueAccessor {
  protected value: SortedMapCredits;

  protected readonly MapCreditType = MapCreditType;
  protected readonly MapCreditNames = MapCreditNames;

  protected readonly connectedTo = Enum.values(MapCreditType).map(String);

  @ViewChildren(TooltipDirective)
  tooltips: QueryList<TooltipDirective>;

  addUser(
    type: MapCreditType,
    user: User,
    searchComponent: UserSearchComponent
  ) {
    const alreadyContainsUser = this.value
      .getAll()
      .some((userEntry) => userEntry.user.id === user.id);
    if (alreadyContainsUser) {
      TooltipDirective.findByContext(this.tooltips, type).setAndShow(
        `User is already in the "${MapCreditNames.get(
          type
        )}" credits, just drag the credit instead!`,
        true
      );
    } else {
      searchComponent.resetSearchBox();
      this.value[type].push({ user, type });
      this.onChange(this.value);
    }
  }

  removeUser(type: MapCreditType, user: Partial<User>) {
    const userIndex = this.value[type].findIndex(
      (credit) => credit.user.id === user.id
    );
    if (userIndex === -1) return;
    this.value[type].splice(userIndex, 1);
    this.onChange(this.value);
  }

  addPlaceholder(type: MapCreditType, input: HTMLInputElement) {
    const alias = input.value;
    input.value = '';
    this.value[type].push({
      user: { alias, avatarURL: STEAM_MISSING_AVATAR_URL },
      type,
      placeholder: true
    });
    this.onChange(this.value);
  }

  drop(event: CdkDragDrop<any[]>) {
    if (event.previousContainer === event.container) {
      moveItemInArray(
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
    }
    this.onChange(this.value);
  }

  writeValue(value: SortedMapCredits | null): void {
    this.value = value ?? new SortedMapCredits();
  }

  onChange: (value: SortedMapCredits) => void = () => void 0;
  registerOnChange(fn: () => void): void {
    this.onChange = fn;
  }

  onTouched = () => void 0;
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
}
