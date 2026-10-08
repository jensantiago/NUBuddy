import assert from 'node:assert/strict';
import test from 'node:test';
import { greeting, reportCounts, ROLE_DOMAINS, schoolRoleForEmail, STATUSES } from '../js/logic.mjs';

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

test('school email role matching accepts only the exact approved domains', () => {
  for (const [role, domain] of Object.entries(ROLE_DOMAINS)) {
    assert.equal(schoolRoleForEmail(`person@${domain}`), role);
  }
  assert.equal(schoolRoleForEmail('PERSON@STUDENTS.NU.EDU.PH'), 'student');
  assert.equal(schoolRoleForEmail('person@nu.edu.ph'), null);
  assert.equal(schoolRoleForEmail('person@students.nu.edu.ph.attacker.test'), null);
  assert.equal(schoolRoleForEmail(' person@guard.nu.edu.ph '), 'security_guard');
});