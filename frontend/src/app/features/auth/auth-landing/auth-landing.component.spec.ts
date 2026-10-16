import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import { vi } from 'vitest';
import { AuthLandingComponent } from './auth-landing.component';
import { AuthService, AuthResponse } from '../../../core/services/auth.service';
import { SanitizedModeService } from '../../../core/services/sanitized-mode.service';

describe('Auth form loading state', () => {
  let fixture: ComponentFixture<AuthLandingComponent>;
  let response: Subject<AuthResponse>;
  let login: ReturnType<typeof vi.fn>;
  let register: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    response = new Subject<AuthResponse>();
    login = vi.fn(() => response);
    register = vi.fn(() => response);
    await TestBed.configureTestingModule({
      imports: [AuthLandingComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: AuthService, useValue: { login, register, hasToken: () => false, isAdmin: () => false } },
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } },
        { provide: SanitizedModeService, useValue: { isSanitizedMode: signal(false) } }]
    }).compileComponents();
    fixture = TestBed.createComponent(AuthLandingComponent);
    await fixture.whenStable();
  });

  it.each(['login', 'register'] as const)('renders a %s failure and clears the spinner without another user click', async tab => {
    const component = fixture.componentInstance;
    component.activeTab = tab;
    component.phone = '0792011285';
    component.password = 'test-password';
    component.confirmPassword = 'test-password';
    component.onSubmit();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.lb-spinner')).toBeTruthy();
    response.error({ status: 503, message: 'Server unavailable. Try again.' });
    // No manual detectChanges: the production zoneless app must schedule this.
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('.lb-spinner')).toBeNull();
    expect(fixture.nativeElement.querySelector('.lb-submit').disabled).toBe(false);
    expect(fixture.nativeElement.querySelector('.lb-alert.error').textContent).toContain('Server unavailable');
  });

  it('sends only one login request while the form is waiting', () => {
    const component = fixture.componentInstance;
    component.phone = '0792011285';
    component.password = 'test-password';
    component.onSubmit();
    component.onSubmit();
    expect(login).toHaveBeenCalledTimes(1);
  });
});
