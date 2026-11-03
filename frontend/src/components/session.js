import { apiClient } from '../api/client.js';
import { store } from '../state/store.js';

export async function requireSession() {
  // Validate persisted credentials with the backend before displaying a session.
  let user;
  try {
    if (apiClient.token) {
      const res = await apiClient.getMe();
      user = res.data;
    }
  } catch {
    apiClient.setToken(null);
  }

  if (!user) {
    user = await showAuthModal();
  }

  const mode = user.role === 'DRIVER' ? 'driver' : 'rider';
  const currentUser = {
    ...user,
    userId: user.id,
    id: mode === 'driver' ? user.driverId : user.id,
  };

  if (mode === 'driver' && !currentUser.id) {
    throw new Error('This account needs a driver profile before driving.');
  }

  store.setState({ currentUser, currentMode: mode });

  if (mode === 'driver') {
    try {
      const driver = (await apiClient.getDriver(currentUser.id)).data;
      store.setState({
        driverAvailability: driver.status,
        currentUser: { ...currentUser, vehicle: driver.vehicle, rating: driver.rating },
      });
    } catch {
      // Driver profile sync error fallback
    }
  }

  // Ensure header has logout button
  const headerRight = document.querySelector('.header-right-tools');
  if (headerRight && !headerRight.querySelector('.session-logout')) {
    const logout = document.createElement('button');
    logout.className = 'session-logout';
    logout.textContent = 'Sign out';
    logout.title = `Signed in as ${user.email} (${user.role.toLowerCase()})`;
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      logout.textContent = 'Signing out…';
      await apiClient.logout();
      window.location.reload();
    });
    headerRight.append(logout);
  }

  return mode;
}

function showAuthModal() {
  return new Promise((resolve) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'session-dialog auth-modal';
    dialog.setAttribute('aria-labelledby', 'auth-modal-title');

    // Dialog state
    let currentView = 'signin'; // 'signin' | 'signup' | 'forgot' | 'reset' | 'verify'
    let alertMessage = '';
    let alertType = 'error'; // 'error' | 'success' | 'info'
    let lastDevToken = '';

    function render() {
      dialog.innerHTML = `
        <div class="auth-card">
          <div class="auth-header">
            <div class="auth-brand-row">
              <span class="session-brand">MIRO</span>
              <span class="auth-badge">${getBadgeText(currentView)}</span>
            </div>
            <h1 id="auth-modal-title" class="auth-title">${getTitle(currentView)}</h1>
            <p class="auth-subtitle">${getSubtitle(currentView)}</p>
          </div>

          ${alertMessage ? `
            <div class="auth-alert auth-alert-${alertType}" role="alert">
              <span>${alertMessage}</span>
            </div>
          ` : ''}

          ${renderCurrentView(currentView, lastDevToken)}
        </div>
      `;

      attachViewEvents();
    }

    function getBadgeText(view) {
      switch (view) {
        case 'signup': return 'Create Account';
        case 'forgot': return 'Recovery';
        case 'reset': return 'Reset';
        case 'verify': return 'Verification';
        default: return 'Secure Access';
      }
    }

    function getTitle(view) {
      switch (view) {
        case 'signup': return 'Join MIRO today';
        case 'forgot': return 'Forgot your password?';
        case 'reset': return 'Choose a new password';
        case 'verify': return 'Verify your email';
        default: return 'Ready when you are.';
      }
    }

    function getSubtitle(view) {
      switch (view) {
        case 'signup': return 'Sign up to ride or drive with real-time tracking';
        case 'forgot': return 'Enter your email address and we’ll send reset instructions';
        case 'reset': return 'Create a strong, secure password for your MIRO account';
        case 'verify': return 'Confirm your email address to access all MIRO services';
        default: return 'Sign in to book a ride or share your driver location.';
      }
    }

    function renderCurrentView(view, devToken) {
      if (view === 'signup') {
        return `
          <form class="session-form auth-form-signup" novalidate>
            <div class="auth-role-picker" role="radiogroup" aria-label="Account Type">
              <label class="auth-role-option">
                <input type="radio" name="role" value="RIDER" checked>
                <div class="auth-role-box">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
                  <span>Rider</span>
                </div>
              </label>
              <label class="auth-role-option">
                <input type="radio" name="role" value="DRIVER">
                <div class="auth-role-box">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                  <span>Driver</span>
                </div>
              </label>
            </div>

            <label class="auth-field">
              <span>Full Name</span>
              <input name="name" type="text" autocomplete="name" placeholder="Alex Morgan" required>
            </label>

            <label class="auth-field">
              <span>Email</span>
              <input name="email" type="email" autocomplete="email" placeholder="alex@example.com" required>
            </label>

            <label class="auth-field">
              <span>Phone</span>
              <input name="phone" type="tel" autocomplete="tel" placeholder="+91 98765 43210" required>
            </label>

            <div class="driver-extra-fields" style="display: none;">
              <label class="auth-field">
                <span>Vehicle Model</span>
                <input name="vehicleModel" type="text" placeholder="Maruti Suzuki Swift" value="Maruti Suzuki Swift">
              </label>
              <label class="auth-field">
                <span>License Plate</span>
                <input name="licensePlate" type="text" placeholder="WB-01-AB-1234" value="WB-01-AB-1234">
              </label>
            </div>

            <label class="auth-field">
              <span>Password (min. 8 characters)</span>
              <div class="password-input-wrap">
                <input name="password" type="password" autocomplete="new-password" placeholder="••••••••" minlength="8" required>
                <button type="button" class="btn-toggle-password" aria-label="Toggle password visibility">👁</button>
              </div>
            </label>

            <label class="auth-field">
              <span>Confirm Password</span>
              <div class="password-input-wrap">
                <input name="confirmPassword" type="password" autocomplete="new-password" placeholder="••••••••" minlength="8" required>
                <button type="button" class="btn-toggle-password" aria-label="Toggle password visibility">👁</button>
              </div>
            </label>

            <label class="auth-checkbox-label">
              <input type="checkbox" name="terms" required checked>
              <span>I agree to MIRO’s Terms of Service and Privacy Policy</span>
            </label>

            <p class="session-error" role="alert"></p>

            <button type="submit" class="btn-driver-cta primary auth-submit-btn">Create Account</button>

            <div class="auth-footer-nav">
              <span>Already have an account?</span>
              <button type="button" class="auth-link btn-switch-signin">Sign in</button>
            </div>
          </form>
        `;
      }

      if (view === 'forgot') {
        return `
          <form class="session-form auth-form-forgot" novalidate>
            <label class="auth-field">
              <span>Account Email</span>
              <input name="email" type="email" autocomplete="email" placeholder="you@example.com" required autofocus>
            </label>

            ${devToken ? `
              <div class="auth-dev-token-box">
                <p class="dev-token-title">🔧 Developer Password Reset Token</p>
                <code class="dev-token-value">${devToken}</code>
                <button type="button" class="btn-copy-dev-token auth-link">Use this token to reset password &rarr;</button>
              </div>
            ` : ''}

            <p class="session-error" role="alert"></p>

            <button type="submit" class="btn-driver-cta primary auth-submit-btn">Send Reset Instructions</button>

            <div class="auth-footer-nav">
              <button type="button" class="auth-link btn-switch-signin">&larr; Back to Sign in</button>
              <button type="button" class="auth-link btn-switch-reset">Have a token? Reset password</button>
            </div>
          </form>
        `;
      }

      if (view === 'reset') {
        return `
          <form class="session-form auth-form-reset" novalidate>
            <label class="auth-field">
              <span>Reset Token</span>
              <input name="token" type="text" placeholder="Paste reset token here" value="${devToken || ''}" required autofocus>
            </label>

            <label class="auth-field">
              <span>New Password (min. 8 characters)</span>
              <div class="password-input-wrap">
                <input name="password" type="password" autocomplete="new-password" placeholder="••••••••" minlength="8" required>
                <button type="button" class="btn-toggle-password" aria-label="Toggle password visibility">👁</button>
              </div>
            </label>

            <label class="auth-field">
              <span>Confirm New Password</span>
              <div class="password-input-wrap">
                <input name="confirmPassword" type="password" autocomplete="new-password" placeholder="••••••••" minlength="8" required>
                <button type="button" class="btn-toggle-password" aria-label="Toggle password visibility">👁</button>
              </div>
            </label>

            <p class="session-error" role="alert"></p>

            <button type="submit" class="btn-driver-cta primary auth-submit-btn">Update Password</button>

            <div class="auth-footer-nav">
              <button type="button" class="auth-link btn-switch-signin">&larr; Back to Sign in</button>
            </div>
          </form>
        `;
      }

      if (view === 'verify') {
        return `
          <form class="session-form auth-form-verify" novalidate>
            <label class="auth-field">
              <span>Verification Token</span>
              <input name="token" type="text" placeholder="Paste verification token here" required autofocus>
            </label>

            <p class="session-error" role="alert"></p>

            <button type="submit" class="btn-driver-cta primary auth-submit-btn">Verify Email</button>

            <div class="auth-divider"><span>OR</span></div>

            <div class="auth-resend-section">
              <label class="auth-field">
                <span>Resend to Email</span>
                <input name="resendEmail" type="email" placeholder="you@example.com">
              </label>
              <button type="button" class="btn-resend-verification auth-secondary-btn">Resend Verification Code</button>
            </div>

            <div class="auth-footer-nav">
              <button type="button" class="auth-link btn-switch-signin">&larr; Back to Sign in</button>
            </div>
          </form>
        `;
      }

      // Default: Sign-in view (preserves exact test contract: .session-form, [name=email], [name=password])
      return `
        <form class="session-form auth-form-signin">
          <label class="auth-field">
            <span>Email</span>
            <input name="email" type="email" autocomplete="username" placeholder="rider@miro.local" required autofocus>
          </label>

          <label class="auth-field">
            <div class="auth-label-row">
              <span>Password</span>
              <button type="button" class="auth-link-sm btn-switch-forgot">Forgot?</button>
            </div>
            <div class="password-input-wrap">
              <input name="password" type="password" autocomplete="current-password" placeholder="••••••••" required>
              <button type="button" class="btn-toggle-password" aria-label="Toggle password visibility">👁</button>
            </div>
          </label>

          <div class="auth-options-row">
            <label class="auth-checkbox-label">
              <input type="checkbox" name="rememberMe">
              <span>Remember me</span>
            </label>
            <button type="button" class="auth-link-sm btn-switch-verify">Verify email</button>
          </div>

          <p class="session-error" role="alert"></p>

          <button type="submit" class="btn-driver-cta primary auth-submit-btn">Sign in</button>

          <div class="auth-demo-chips">
            <span class="auth-demo-label">Quick demo accounts:</span>
            <div class="auth-chips-row">
              <button type="button" class="auth-chip" data-email="rider@miro.local" data-pass="password123">Rider (Rohan)</button>
              <button type="button" class="auth-chip" data-email="driver1@miro.local" data-pass="password123">Driver D1 (Debashis)</button>
            </div>
          </div>

          <div class="auth-footer-nav">
            <span>Don’t have an account?</span>
            <button type="button" class="auth-link btn-switch-signup">Sign up</button>
          </div>
        </form>
      `;
    }

    function switchView(view, msg = '', msgType = 'info') {
      currentView = view;
      alertMessage = msg;
      alertType = msgType;
      render();
    }

    function attachViewEvents() {
      // Password show/hide toggle buttons
      dialog.querySelectorAll('.btn-toggle-password').forEach(btn => {
        btn.addEventListener('click', () => {
          const input = btn.previousElementSibling;
          if (!input) return;
          const isPassword = input.type === 'password';
          input.type = isPassword ? 'text' : 'password';
          btn.textContent = isPassword ? '🙈' : '👁';
          btn.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        });
      });

      // Navigation buttons between views
      dialog.querySelector('.btn-switch-signup')?.addEventListener('click', () => switchView('signup'));
      dialog.querySelector('.btn-switch-signin')?.addEventListener('click', () => switchView('signin'));
      dialog.querySelector('.btn-switch-forgot')?.addEventListener('click', () => switchView('forgot'));
      dialog.querySelector('.btn-switch-reset')?.addEventListener('click', () => switchView('reset'));
      dialog.querySelector('.btn-switch-verify')?.addEventListener('click', () => switchView('verify'));

      // Quick demo chips fill
      dialog.querySelectorAll('.auth-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          const form = dialog.querySelector('form');
          if (form) {
            const emailInput = form.querySelector('[name=email]');
            const passInput = form.querySelector('[name=password]');
            if (emailInput) emailInput.value = chip.dataset.email;
            if (passInput) passInput.value = chip.dataset.pass;
          }
        });
      });

      // Driver role selector toggle
      if (currentView === 'signup') {
        const roleInputs = dialog.querySelectorAll('input[name="role"]');
        const driverFields = dialog.querySelector('.driver-extra-fields');
        roleInputs.forEach(input => {
          input.addEventListener('change', () => {
            if (driverFields) {
              driverFields.style.display = input.value === 'DRIVER' ? 'grid' : 'none';
            }
          });
        });
      }

      // Dev token copy / transfer
      dialog.querySelector('.btn-copy-dev-token')?.addEventListener('click', () => {
        switchView('reset', 'Token loaded. Enter your new password below.', 'info');
      });

      // Resend verification button in verify view
      dialog.querySelector('.btn-resend-verification')?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const form = dialog.querySelector('form');
        const email = form?.elements.resendEmail?.value || form?.elements.email?.value;
        const errEl = form?.querySelector('.session-error');
        if (!email) {
          if (errEl) errEl.textContent = 'Please provide an email to resend verification.';
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Resending…';
        try {
          const res = await apiClient.resendVerification(email);
          alertMessage = res.message || 'Verification email resent if account exists.';
          alertType = 'info';
          render();
        } catch (err) {
          if (errEl) errEl.textContent = err.message;
        } finally {
          btn.disabled = false;
          btn.textContent = 'Resend Verification Code';
        }
      });

      // Submit handlers based on currentView
      const form = dialog.querySelector('form');
      if (!form) return;

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = form.querySelector('.auth-submit-btn');
        const errEl = form.querySelector('.session-error');
        if (errEl) errEl.textContent = '';

        if (currentView === 'signin') {
          const email = form.elements.email?.value?.trim();
          const password = form.elements.password?.value;
          const rememberMe = form.elements.rememberMe?.checked ?? false;

          if (!email || !password) {
            if (errEl) errEl.textContent = 'Email and password are required.';
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Signing in…';

          try {
            const result = await apiClient.login(email, password, rememberMe);
            if (!result.data?.user || !['RIDER', 'DRIVER'].includes(result.data.user.role)) {
              throw new Error('Use a rider or driver account.');
            }
            dialog.close();
            dialog.remove();
            resolve(result.data.user);
          } catch (err) {
            if (errEl) errEl.textContent = err.message;
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign in';
          }
        } else if (currentView === 'signup') {
          const role = form.querySelector('input[name="role"]:checked')?.value || 'RIDER';
          const name = form.elements.name?.value?.trim();
          const email = form.elements.email?.value?.trim();
          const phone = form.elements.phone?.value?.trim();
          const password = form.elements.password?.value;
          const confirmPassword = form.elements.confirmPassword?.value;
          const terms = form.elements.terms?.checked;

          if (!name || !email || !phone || !password) {
            if (errEl) errEl.textContent = 'Please fill out all required fields.';
            return;
          }
          if (password.length < 8) {
            if (errEl) errEl.textContent = 'Password must be at least 8 characters long.';
            return;
          }
          if (password !== confirmPassword) {
            if (errEl) errEl.textContent = 'Passwords do not match.';
            return;
          }
          if (!terms) {
            if (errEl) errEl.textContent = 'You must agree to the Terms of Service to continue.';
            return;
          }

          const payload = {
            name,
            email,
            phone,
            password,
            role,
          };

          if (role === 'DRIVER') {
            payload.vehicle = {
              model: form.elements.vehicleModel?.value?.trim() || 'Standard Sedan',
              numberPlate: form.elements.licensePlate?.value?.trim() || 'WB-01-XX-0000',
            };
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Creating Account…';

          try {
            const result = await apiClient.register(payload);
            if (!result.data?.user) {
              throw new Error('Registration completed without a session.');
            }
            dialog.close();
            dialog.remove();
            resolve(result.data.user);
          } catch (err) {
            if (errEl) errEl.textContent = err.message;
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Create Account';
          }
        } else if (currentView === 'forgot') {
          const email = form.elements.email?.value?.trim();
          if (!email) {
            if (errEl) errEl.textContent = 'Please enter your email.';
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Submitting…';

          try {
            const res = await apiClient.forgotPassword(email);
            lastDevToken = res.devResetToken || '';
            const msg = res.message || 'If an account exists, password reset instructions have been sent.';
            switchView('forgot', msg, 'info');
          } catch (err) {
            if (errEl) errEl.textContent = err.message;
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Send Reset Instructions';
          }
        } else if (currentView === 'reset') {
          const token = form.elements.token?.value?.trim();
          const password = form.elements.password?.value;
          const confirmPassword = form.elements.confirmPassword?.value;

          if (!token || !password) {
            if (errEl) errEl.textContent = 'Token and new password are required.';
            return;
          }
          if (password.length < 8) {
            if (errEl) errEl.textContent = 'Password must be at least 8 characters long.';
            return;
          }
          if (password !== confirmPassword) {
            if (errEl) errEl.textContent = 'Passwords do not match.';
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Updating…';

          try {
            await apiClient.resetPassword(token, password);
            switchView('signin', 'Password updated successfully! You may now sign in.', 'success');
          } catch (err) {
            if (errEl) errEl.textContent = err.message;
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Update Password';
          }
        } else if (currentView === 'verify') {
          const token = form.elements.token?.value?.trim();
          if (!token) {
            if (errEl) errEl.textContent = 'Please enter the verification token.';
            return;
          }

          submitBtn.disabled = true;
          submitBtn.textContent = 'Verifying…';

          try {
            await apiClient.verifyEmail(token);
            switchView('signin', 'Email verified successfully! You may now sign in.', 'success');
          } catch (err) {
            if (errEl) errEl.textContent = err.message;
          } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Verify Email';
          }
        }
      });
    }

    document.body.append(dialog);
    dialog.addEventListener('cancel', event => event.preventDefault());
    render();
    dialog.showModal();
  });
}
