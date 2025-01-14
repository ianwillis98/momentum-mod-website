import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { MMap, User } from '@momentum/constants';
import { UserSearchComponent } from './user-search/user-search.component';
import { MapSearchComponent } from './user-search/map-search.component';

enum SearchType {
  USER,
  MAP
}

@Component({
  selector: 'm-search',
  standalone: true,
  imports: [CommonModule, FormsModule, UserSearchComponent, MapSearchComponent],
  templateUrl: './search.component.html',
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-width: 32rem;
      }
    `
  ]
})
export class SearchComponent {
  protected readonly SearchType = SearchType;
  protected activeType: SearchType = SearchType.MAP;
  @Output() readonly selected = new EventEmitter<void>();

  constructor(private readonly router: Router) {}

  userSelected(user: User) {
    this.router.navigateByUrl(`/profile/${user.id}`);
    this.selected.emit();
  }

  mapSelected(map: MMap) {
    this.router.navigateByUrl(`/maps/${map.id}`);
    this.selected.emit();
  }
}
