import { Route } from '@angular/router';
import { MapQueueComponent } from './map-queue/map-queue.component';
import { ReportQueueComponent } from './report-queue/report-queue.component';
import { UtilitiesComponent } from './utilities/utilities.component';

export default [
  {
    path: 'map-queue',
    pathMatch: 'full', // TODO: I don't know why this and below have pathMatch, maybe remove?
    component: MapQueueComponent
  },
  {
    path: 'report-queue',
    pathMatch: 'full',
    component: ReportQueueComponent
  },
  { path: 'utilities', component: UtilitiesComponent }
] satisfies Route[];
