export const STATUSES = ['Submitted', 'Under Review', 'In Progress', 'Resolved'];
export const ROLE_DOMAINS = {
  student: 'students.nu.edu.ph',
  facility_admin: 'admin.nu.edu.ph',
  security_guard: 'guard.nu.edu.ph',
};

export function schoolRoleForEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(normalized)) return null;
  return Object.entries(ROLE_DOMAINS).find(([, domain]) => normalized.endsWith(`@${domain}`))?.[0] || null;
}

export function reportCounts(reports) {
  return {
    total: reports.length,
    open: reports.filter((report) => report.status !== 'Resolved').length,
    pending: reports.filter((report) => report.status === 'Submitted').length,
    active: reports.filter((report) => ['Under Review', 'In Progress'].includes(report.status)).length,
    progress: reports.filter((report) => report.status === 'In Progress').length,
    resolved: reports.filter((report) => report.status === 'Resolved').length,
  };
}

export function greeting(now = new Date()) {
  const hour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila', hour: '2-digit', hourCycle: 'h23',
  }).format(now));
  return hour >= 5 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening';
}

export function localDateTime(time) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'long', timeStyle: 'short',
  }).format(new Date(time));
}

export function localDate(time) {
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'medium',
  }).format(new Date(time));
}