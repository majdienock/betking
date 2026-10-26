import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { getBackendOrigin } from '../config/backend-url';
import { afterEach, vi } from 'vitest';

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;
  let origin: string;
  const credentials = { username: 'test-player', password: 'test-password' };
  const response = {
    token: 'test-token',
    message: 'Login successful',
    user: { id: 1, username: 'test-player', balance: 100, role: 'user' }
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
    origin = getBackendOrigin();
  });

  afterEach(() => {
    http.verify({ ignoreCancelled: true });
    localStorage.clear();
    sessionStorage.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('waits for backend readiness before submitting credentials', () => {
    const received = vi.fn();
    service.login(credentials).subscribe(received);
    http.expectNone(`${origin}/api/auth/login`);
    http.expectOne(`${origin}/healthz`).flush({ status: 'ok' });
    const login = http.expectOne(`${origin}/api/auth/login`);
    expect(login.request.body).toEqual(credentials);
    login.flush(response);
    expect(received).toHaveBeenCalledWith(response);
    expect(service.getToken()).toBe('test-token');
  });

  it('can wake a backend taking longer than the login request timeout', () => {
    service.login(credentials).subscribe();
    for (let attempt = 0; attempt < 3; attempt++) {
      const health = http.expectOne(`${origin}/healthz`);
      vi.advanceTimersByTime(10000);
      expect(health.cancelled).toBe(true);
      vi.advanceTimersByTime(2000);
      http.expectNone(`${origin}/api/auth/login`);
    }
    http.expectOne(`${origin}/healthz`).flush({ status: 'ok' });
    http.expectOne(`${origin}/api/auth/login`).flush(response);
    expect(service.isAuthenticated$.value).toBe(true);
  });

  it('shares the background warmup with login and retries only the health check', () => {
    const warmed = vi.fn();
    service.prepareBackend().subscribe(warmed);
    service.login(credentials).subscribe();
    http.expectOne(`${origin}/healthz`).flush({ status: 'unavailable' }, { status: 503, statusText: 'Unavailable' });
    http.expectNone(`${origin}/api/auth/login`);
    vi.advanceTimersByTime(2000);
    http.expectOne(`${origin}/healthz`).flush({ status: 'ok' });
    expect(warmed).toHaveBeenCalledTimes(1);
    http.expectOne(`${origin}/api/auth/login`).flush(response);
  });

  it('never retries a login POST when the server returns an error', () => {
    const failed = vi.fn();
    service.login(credentials).subscribe({ error: failed });
    http.expectOne(`${origin}/healthz`).flush({ status: 'ok' });
    http.expectOne(`${origin}/api/auth/login`).flush({ error: 'Temporarily unavailable' }, { status: 503, statusText: 'Unavailable' });
    vi.advanceTimersByTime(90000);
    expect(failed).toHaveBeenCalledWith({ status: 503, message: 'Temporarily unavailable' });
    http.expectNone(`${origin}/api/auth/login`);
    http.expectNone(`${origin}/healthz`);
  });

  it('does not replay registration after its POST times out', () => {
    const failed = vi.fn();
    service.register(credentials).subscribe({ error: failed });
    http.expectOne(`${origin}/healthz`).flush({ status: 'ok' });
    const registration = http.expectOne(`${origin}/api/auth/register`);
    vi.advanceTimersByTime(30000);
    expect(registration.cancelled).toBe(true);
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ status: 0 }));
    vi.advanceTimersByTime(90000);
    http.expectNone(`${origin}/api/auth/register`);
    http.expectNone(`${origin}/healthz`);
  });

  it('bounds a persistent startup failure and never submits credentials', () => {
    const failed = vi.fn();
    service.login(credentials).subscribe({ error: failed });
    vi.advanceTimersByTime(90000);
    expect(failed).toHaveBeenCalledWith({
      status: 503,
      message: 'The server is still starting or unavailable. Please try again shortly.'
    });
    const attempts = http.match(`${origin}/healthz`);
    expect(attempts.length).toBeGreaterThan(1);
    expect(attempts.every(request => request.cancelled)).toBe(true);
    http.expectNone(`${origin}/api/auth/login`);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not retry an invalid backend configuration', () => {
    const failed = vi.fn();
    service.login(credentials).subscribe({ error: failed });
    http.expectOne(`${origin}/healthz`).flush({ configuration: 'invalid' }, { status: 503, statusText: 'Unavailable' });
    expect(failed).toHaveBeenCalledWith(expect.objectContaining({ status: 503 }));
    vi.advanceTimersByTime(90000);
    http.expectNone(`${origin}/healthz`);
    http.expectNone(`${origin}/api/auth/login`);
  });
});
