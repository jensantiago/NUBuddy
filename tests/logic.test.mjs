import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canUpdateReportStatus, greeting, registrationPasswordChecks, reportCounts, reportMatchesDateFilter, ROLE_DOMAINS, schoolRoleForEmail, STATUSES } from '../js/logic.mjs';

const facultyMigration = readFileSync(new URL('../supabase/migrations/20261013130737_faculty_reporting.sql', import.meta.url), 'utf8');
const backendMigration = readFileSync(new URL('../supabase/migrations/20261008000000_nu_buddy_backend.sql', import.meta.url), 'utf8');
const compatibilityMigration = readFileSync(new URL('../supabase/migrations/20261013000000_status_notifications_compatibility.sql', import.meta.url), 'utf8');

test('Philippine-time greeting boundaries are inclusive at the specified minute', () => {
  const cases = [
    ['2026-10-08T20:59:00Z', 'evening'],
    ['2026-10-08T21:00:00Z', 'morning'],
    ['2026-10-08T03:59:00Z', 'morning'],
    ['2026-10-08T04:00:00Z', 'afternoon'],
    ['2026-10-08T09:59:00Z', 'afternoon'],
    ['2026-10-08T10:00:00Z', 'evening'],
  ];

  for (const [instant, expected] of cases) {
    assert.equal(greeting(new Date(instant)), expected, instant);
  }
});

test('dashboard counts use the shared exact status definitions', () => {
  assert.deepEqual(STATUSES, ['Submitted', 'Under Review', 'In Progress', 'Resolved']);
  const reports = STATUSES.map((status) => ({ status }));
  assert.deepEqual(reportCounts(reports), {
    total: 4,
    open: 3,
    pending: 1,
    active: 2,
    progress: 1,
    resolved: 1,
  });
});

test('only approved staff can update report status, regardless of category', () => {
  assert.equal(canUpdateReportStatus({ role: 'facility_admin', account_status: 'approved' }), true);
  assert.equal(canUpdateReportStatus({ role: 'security_guard', account_status: 'approved' }), true);
  assert.equal(canUpdateReportStatus({ role: 'student', account_status: 'approved' }), false);
  assert.equal(canUpdateReportStatus({ role: 'faculty', account_status: 'approved' }), false);
  assert.equal(canUpdateReportStatus({ role: 'security_guard', account_status: 'pending' }), false);
  assert.equal(canUpdateReportStatus({ role: 'facility_admin', account_status: 'rejected' }), false);
  assert.equal(canUpdateReportStatus(null), false);
});

test('registration password checks update each requirement and confirmation match', () => {
  assert.deepEqual(registrationPasswordChecks(), { length: false, uppercase: false, number: false, matching: false });
  assert.deepEqual(registrationPasswordChecks('short'), { length: false, uppercase: false, number: false, matching: false });
  assert.deepEqual(registrationPasswordChecks('longenough', 'longenough'), { length: true, uppercase: false, number: false, matching: true });
  assert.deepEqual(registrationPasswordChecks('Longenough', 'Longenough'), { length: true, uppercase: true, number: false, matching: true });
  assert.deepEqual(registrationPasswordChecks('Long1234', 'Long123'), { length: true, uppercase: true, number: true, matching: false });
  assert.deepEqual(registrationPasswordChecks('Long1234', 'Long1234'), { length: true, uppercase: true, number: true, matching: true });
});

test('report date filters include their exact cutoff and reject invalid dates', () => {
  const now = Date.parse('2026-10-13T12:00:00Z');
  assert.equal(reportMatchesDateFilter('2026-10-13T12:00:00Z', 'All', now), true);
  assert.equal(reportMatchesDateFilter('2026-10-06T12:00:00Z', '7days', now), true);
  assert.equal(reportMatchesDateFilter('2026-10-06T11:59:59Z', '7days', now), false);
  assert.equal(reportMatchesDateFilter('2026-09-13T12:00:00Z', '30days', now), true);
  assert.equal(reportMatchesDateFilter('2026-09-13T11:59:59Z', 'older', now), true);
  assert.equal(reportMatchesDateFilter('invalid', '30days', now), false);
});

test('school email role matching accepts official domains and only the exact development account', () => {
  assert.deepEqual(ROLE_DOMAINS, {
    student: 'students.nu.edu.ph',
    faculty: 'faculty.nu.edu.ph',
    facility_admin: 'admin.nu.edu.ph',
    security_guard: 'guard.nu.edu.ph',
  });
  for (const [role, domain] of Object.entries(ROLE_DOMAINS)) {
    assert.equal(schoolRoleForEmail(`person@${domain}`), role);
  }
  assert.equal(schoolRoleForEmail('test@students.nu.edu.ph'), 'student');
  assert.equal(schoolRoleForEmail('test@faculty.nu.edu.ph'), 'faculty');
  assert.equal(schoolRoleForEmail(' FACULTY@FACULTY.NU.EDU.PH '), 'faculty');
  assert.equal(schoolRoleForEmail('faculty@gmail.com'), null);
  assert.equal(schoolRoleForEmail('test@admin.nu.edu.ph'), 'facility_admin');
  assert.equal(schoolRoleForEmail('test@guard.nu.edu.ph'), 'security_guard');
  assert.equal(schoolRoleForEmail('santiagojenina683@gmail.com'), 'facility_admin');
  assert.equal(schoolRoleForEmail('SANTIAGOJENINA683@GMAIL.COM'), 'facility_admin');
  assert.equal(schoolRoleForEmail('test@gmail.com'), null);
  assert.equal(schoolRoleForEmail('santiagojenina683+test@gmail.com'), null);
  assert.equal(schoolRoleForEmail('test@constructor'), null);
  assert.equal(schoolRoleForEmail('PERSON@STUDENTS.NU.EDU.PH'), 'student');
  assert.equal(schoolRoleForEmail('student@students.nu.edu.ph'), 'student');
  assert.equal(schoolRoleForEmail('admin@admin.nu.edu.ph'), 'facility_admin');
  assert.equal(schoolRoleForEmail('guard@guard.nu.edu.ph'), 'security_guard');
  assert.equal(schoolRoleForEmail('person@nu.edu.ph'), null);
  assert.equal(schoolRoleForEmail('person@example.com'), null);
  assert.equal(schoolRoleForEmail('person@students.nu.edu.ph.attacker.test'), null);
  assert.equal(schoolRoleForEmail(' person@guard.nu.edu.ph '), 'security_guard');
});

test('faculty role is assigned by normalized server-side email during new registration only', () => {
  assert.ok(facultyMigration.includes("when lower(btrim(p_email)) ~ '^[^[:space:]@]+@faculty\\.nu\\.edu\\.ph$' then 'faculty'"));
  assert.ok(facultyMigration.includes('v_role := app_private.role_for_email(new.email)'));
  assert.ok(facultyMigration.includes("case when v_role in ('student', 'faculty') then 'approved' else 'pending' end"));
  assert.doesNotMatch(facultyMigration, /raw_user_meta_data\s*->>\s*'role'/);
  assert.doesNotMatch(facultyMigration, /update\s+public\.profiles|insert\s+into\s+public\.profiles[\s\S]*?\bselect\b/i);
});

test('faculty inherits owner-scoped data access and remains outside staff status permissions', () => {
  assert.match(backendMigration, /owner_id = auth\.uid\(\) or public\.is_active_staff\(\)/);
  assert.match(backendMigration, /public\.is_active_user\(\) and owner_id = auth\.uid\(\) and status = 'Submitted'/);
  assert.match(backendMigration, /r\.owner_id = auth\.uid\(\) or public\.is_active_staff\(\)/);
  assert.match(backendMigration, /public\.is_active_user\(\) and recipient_id = auth\.uid\(\)/);
  assert.match(compatibilityMigration, /if not public\.is_active_staff\(\) then/);
  assert.doesNotMatch(facultyMigration, /drop policy|create policy|update_report_status|grant update/i);
});
