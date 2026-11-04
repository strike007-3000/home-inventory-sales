import { describe, expect, it } from 'vitest';
import { planDuePaise } from '../../src/domain';

const plan = { monthlyPaise: 100000, startDate: '2026-09-15', months: null, savedPaise: 0, status: 'open' };
const nov = new Date(2026, 10, 4);

describe('planDuePaise', () => {
  it('counts installments from the start month through the current month', () => {
    expect(planDuePaise(plan, nov)).toBe(300000);
    expect(planDuePaise({ ...plan, savedPaise: 200000 }, nov)).toBe(100000);
  });
  it('is zero when paid up, not started, or not open', () => {
    expect(planDuePaise({ ...plan, savedPaise: 300000 }, nov)).toBe(0);
    expect(planDuePaise({ ...plan, startDate: '2026-12-01' }, nov)).toBe(0);
    expect(planDuePaise({ ...plan, status: 'cancelled' }, nov)).toBe(0);
  });
  it('caps at the plan length', () => {
    expect(planDuePaise({ ...plan, months: 2 }, nov)).toBe(200000);
  });
});
