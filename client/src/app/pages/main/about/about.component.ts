import { Component, OnInit } from '@angular/core';

@Component({
  selector: 'ngx-about',
  templateUrl: './about.component.html',
  styleUrls: ['./about.component.scss']
})
export class AboutComponent implements OnInit {
  showAboutVideo: boolean;
  constructor() {
    this.showAboutVideo = false;
  }

  ngOnInit() {}
}
