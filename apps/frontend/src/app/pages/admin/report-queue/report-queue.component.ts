import { Component, OnInit } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { ReportType } from '@momentum/constants';
import { Report } from '@momentum/constants';
import { AdminService } from '@momentum/frontend/data';
import { QueuedReportComponent } from './queued-report/queued-report.component';
import { SharedModule } from '../../../shared.module';
import { MessageService } from 'primeng/api';

@Component({
  selector: 'm-report-queue',
  templateUrl: './report-queue.component.html',
  standalone: true,
  imports: [SharedModule, QueuedReportComponent]
})
export class ReportQueueComponent implements OnInit {
  protected readonly ReportType = ReportType;
  isLoading = false;
  reportQueue: Report[];
  reportQueueCount = 0;
  pageLimit = 5;
  currentPage = 1;
  filters = { resolved: false };

  constructor(
    private readonly adminService: AdminService,
    private readonly toasterService: MessageService
  ) {}

  ngOnInit() {
    this.loadReportQueue();
  }

  loadReportQueue() {
    this.reportQueue = [];
    this.reportQueueCount = 0;
    this.isLoading = true;
    this.adminService
      .getReports({
        expand: ['submitter', 'resolver'],
        skip: (this.currentPage - 1) * this.pageLimit,
        resolved: this.filters.resolved
      })
      .pipe(finalize(() => (this.isLoading = false)))
      .subscribe({
        next: (response) => {
          this.reportQueueCount = response.totalCount;
          this.reportQueue = response.data;
        },
        error: (error) => {
          console.error(error);
          this.toasterService.add({
            severity: 'error',
            summary: 'Failed to load report queue',
            detail: error.message
          });
        }
      });
  }

  onPageChange(pageNum) {
    this.currentPage = pageNum;
    this.loadReportQueue();
  }
}
