import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { GmailService } from '../src/app/services/gmail.service';

describe('GmailService', () => {
  let service: GmailService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [GmailService],
    });

    service = TestBed.inject(GmailService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getOAuthUrl', () => {
    it('should fetch OAuth URL', () => {
      const mockResponse = {
        url: 'https://accounts.google.com/o/oauth2/v2/auth?...',
      };

      service.getOAuthUrl().subscribe((response) => {
        expect(response.url).toContain('accounts.google.com');
      });

      const req = httpMock.expectOne('/api/gmail/oauth/url');
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });
  });

  describe('handleOAuthCallback', () => {
    it('should handle OAuth callback with code', () => {
      const mockResponse = {
        message: 'Gmail connected successfully',
        gmailEmail: 'user@gmail.com',
      };

      service.handleOAuthCallback('auth_code_123').subscribe((response) => {
        expect(response.gmailEmail).toBe('user@gmail.com');
      });

      const req = httpMock.expectOne((r) =>
        r.url.includes('/api/gmail/oauth/callback') && r.method === 'GET'
      );
      req.flush(mockResponse);
    });
  });

  describe('disconnectGmail', () => {
    it('should disconnect Gmail account', () => {
      const mockResponse = {
        message: 'Gmail disconnected successfully',
      };

      service.disconnectGmail().subscribe((response) => {
        expect(response.message).toContain('disconnected');
      });

      const req = httpMock.expectOne('/api/gmail/disconnect');
      expect(req.request.method).toBe('POST');
      req.flush(mockResponse);
    });
  });

  describe('fetchEmails', () => {
    it('should fetch emails from Gmail', () => {
      const mockResponse = {
        emails: [
          {
            gmailMessageId: 'msg_1',
            from: 'sender@example.com',
            subject: 'Test Email',
            snippet: 'Preview...',
          },
        ],
        total: 1,
      };

      service.fetchEmails({ unread: true, limit: 20 }).subscribe((response) => {
        expect(response.emails.length).toBeGreaterThan(0);
        expect(response.emails[0].from).toBeDefined();
      });

      const req = httpMock.expectOne((r) => r.url.includes('/api/emails') && r.method === 'GET');
      req.flush(mockResponse);
    });
  });

  describe('getEmailDetail', () => {
    it('should fetch detailed email content', () => {
      const mockEmail = {
        gmailMessageId: 'msg_123',
        from: 'sender@example.com',
        to: 'user@gmail.com',
        subject: 'Test Email',
        bodyPlain: 'Full email body content',
        internalDate: '2024-05-06T10:00:00Z',
      };

      service.getEmailDetail('msg_123').subscribe((email) => {
        expect(email.bodyPlain).toBeDefined();
      });

      const req = httpMock.expectOne('/api/emails/msg_123');
      expect(req.request.method).toBe('GET');
      req.flush(mockEmail);
    });
  });
});
