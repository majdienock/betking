import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('renders the BetPesa app name and logo in the install prompt', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    fixture.componentInstance.showDownloadPrompt.set(true);
    fixture.componentInstance.isPromptFreeRoute.set(false);
    fixture.componentInstance.isAdminUser.set(false);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.app-name')?.textContent).toBe('BetPesa App');
    expect(compiled.querySelector('.app-icon-img')?.getAttribute('src')).toBe('/assets/images/betpesa-logo.png');
  });
});
