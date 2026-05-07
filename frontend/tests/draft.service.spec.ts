import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DraftService } from '../src/app/services/draft.service';

describe('DraftService', () => {
  let service: DraftService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [DraftService],
    });

    service = TestBed.inject(DraftService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('generateDraft', () => {
    it('should generate a draft', () => {
      const mockResponse = {
        id: 'draft123',
        status: 'PENDING',
        tone: 'formal',
        draftBody: 'Generated reply...',
        gmailMessageId: 'msg123',
      };

      service.generateDraft('msg123', 'formal').subscribe((draft) => {
        expect(draft.status).toBe('PENDING');
        expect(draft.draftBody).toBeDefined();
      });

      const req = httpMock.expectOne('/api/drafts/generate');
      expect(req.request.method).toBe('POST');
      expect(req.request.body.gmailMessageId).toBe('msg123');
      expect(req.request.body.tone).toBe('formal');
      req.flush(mockResponse);
    });
  });

  describe('getDrafts', () => {
    it('should retrieve list of drafts', () => {
      const mockResponse = {
        drafts: [
          {
            id: 'draft1',
            status: 'PENDING',
            draftBody: 'Draft 1',
          },
          {
            id: 'draft2',
            status: 'APPROVED',
            draftBody: 'Draft 2',
          },
        ],
        total: 2,
      };

      service.getDrafts({ status: 'PENDING' }).subscribe((response) => {
        expect(response.drafts.length).toBe(2);
        expect(response.total).toBe(2);
      });

      const req = httpMock.expectOne((r) => r.url === '/api/drafts' && r.method === 'GET');
      req.flush(mockResponse);
    });
  });

  describe('getDraftById', () => {
    it('should retrieve a specific draft', () => {
      const mockDraft = {
        id: 'draft123',
        status: 'PENDING',
        draftBody: 'Draft content',
        gmailMessageId: 'msg123',
      };

      service.getDraftById('draft123').subscribe((draft) => {
        expect(draft.id).toBe('draft123');
      });

      const req = httpMock.expectOne('/api/drafts/draft123');
      expect(req.request.method).toBe('GET');
      req.flush(mockDraft);
    });
  });

  describe('updateDraft', () => {
    it('should update draft body', () => {
      const updatedDraft = {
        id: 'draft123',
        draftBody: 'Updated content',
        status: 'PENDING',
      };

      service.updateDraft('draft123', 'Updated content').subscribe((draft) => {
        expect(draft.draftBody).toBe('Updated content');
      });

      const req = httpMock.expectOne('/api/drafts/draft123');
      expect(req.request.method).toBe('PUT');
      req.flush(updatedDraft);
    });
  });

  describe('approveDraft', () => {
    it('should approve a draft', () => {
      const approvedDraft = {
        id: 'draft123',
        status: 'APPROVED',
        approvedAt: new Date().toISOString(),
      };

      service.approveDraft('draft123').subscribe((draft) => {
        expect(draft.status).toBe('APPROVED');
        expect(draft.approvedAt).toBeDefined();
      });

      const req = httpMock.expectOne('/api/drafts/draft123/approve');
      expect(req.request.method).toBe('POST');
      req.flush(approvedDraft);
    });
  });

  describe('rejectDraft', () => {
    it('should reject a draft', () => {
      const rejectedDraft = {
        id: 'draft123',
        status: 'REJECTED',
        rejectedAt: new Date().toISOString(),
      };

      service.rejectDraft('draft123').subscribe((draft) => {
        expect(draft.status).toBe('REJECTED');
      });

      const req = httpMock.expectOne('/api/drafts/draft123/reject');
      expect(req.request.method).toBe('POST');
      req.flush(rejectedDraft);
    });
  });

  describe('sendDraft', () => {
    it('should send an approved draft', () => {
      const sentDraft = {
        id: 'draft123',
        status: 'SENT',
        sentAt: new Date().toISOString(),
        sentGmailMessageId: 'msg_sent_123',
      };

      service.sendDraft('draft123', 'unique-key-123').subscribe((draft) => {
        expect(draft.status).toBe('SENT');
        expect(draft.sentGmailMessageId).toBeDefined();
      });

      const req = httpMock.expectOne('/api/drafts/draft123/send');
      expect(req.request.method).toBe('POST');
      req.flush(sentDraft);
    });
  });
});
