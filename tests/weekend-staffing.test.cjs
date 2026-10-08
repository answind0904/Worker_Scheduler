const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the existing browser engine without running its DOM initialization.
function engine(groups, config = {}) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const context = vm.createContext({
    document: { addEventListener() {} },
    window: { setTimeout() {}, clearTimeout() {} }
  });
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, `
    state = createDefaultState();
    el.notice = {};
    globalThis.api = {
      state, createEmployee, generateSchedule, validateSchedule, getScheduleDays,
      fillRedDay, forceExactTargetOff, findRestSwap, findMRepairCandidate,
      enforceMaxConsecutive, writeDataToState, countOff
    };
  })();`), context);
  const api = context.api;
  api.state.employees = groups.map((group, i) => api.createEmployee('직원 ' + i, group));
  Object.assign(api.state.config, {
    startDate: '2026-10-10', endDate: '2026-10-10', targetOffDays: 0,
    fridayDs: 3, minActive: 0, minEs: 0, maxConsecutive: 6, ...config
  });
  return api;
}

test('Saturday and Sunday dispatch fill subtracts existing manual workers', () => {
  for (const [date, expected] of [['2026-10-10', 3], ['2026-10-11', 2]]) {
    const api = engine(Array(5).fill('파견직'), { startDate: date, endDate: date });
    const data = [['S'], [''], [''], [''], ['']];
    const zeros = () => Array(5).fill(0);
    api.fillRedDay(data, 0, api.state.employees, new Set([0]), zeros(), zeros(), zeros(), api.getScheduleDays()[0]);
    assert.equal(data.filter(row => row[0] === 'S').length, expected);
    assert.equal(data[0][0], 'S');
  }
});

test('rest correction cannot add work above either weekend quota', () => {
  const api = engine([...Array(4).fill('일반직'), ...Array(4).fill('파견직')]);
  const data = ['D', 'S', 'S', 'R', 'S', 'S', 'S', 'R'].map(role => [role]);
  api.forceExactTargetOff(data, api.getScheduleDays(), api.state.employees);
  assert.equal(data[3][0], 'R');
  assert.equal(data[7][0], 'R');
  api.writeDataToState(data, api.getScheduleDays(), api.state.employees);
  assert.ok(api.validateSchedule().some(issue => issue.title === '목표 휴무 초과'));
});

test('rest correction uses an available weekday instead of an already full weekend', () => {
  const api = engine(Array(4).fill('일반직'), { startDate: '2026-10-09', endDate: '2026-10-10', targetOffDays: 1 });
  const data = [['X', 'D'], ['X', 'S'], ['X', 'S'], ['R', 'R']];
  api.forceExactTargetOff(data, api.getScheduleDays(), api.state.employees);
  assert.deepEqual(data[3], ['S', 'R']);
});

test('same-group rest swap remains possible at the exact weekend quota', () => {
  const api = engine(Array(4).fill('일반직'));
  const data = ['D', 'S', 'S', 'R'].map(role => [role]);
  const swap = api.findRestSwap(data, api.getScheduleDays(), api.state.employees, 1, [0, 0, 0, 1], [0, 1, 0, 0]);
  assert.ok(swap);
  assert.equal(swap.donor, 3);
});

test('validation reports excess and shortage for both weekend groups', () => {
  const api = engine([...Array(4).fill('일반직'), ...Array(4).fill('파견직')]);
  for (const [roles, suffix] of [
    [['D', 'S', 'S', 'S', 'S', 'S', 'S', 'S'], '초과'],
    [['D', 'R', 'R', 'R', 'S', 'R', 'R', 'R'], '부족']
  ]) {
    api.writeDataToState(roles.map(role => [role]), api.getScheduleDays(), api.state.employees);
    const issues = api.validateSchedule();
    assert.ok(issues.some(issue => issue.title === '토/일 D+S ' + suffix));
    assert.ok(issues.some(issue => issue.title === '토/일 파견직 출근 ' + suffix));
  }
});

test('cross-group rest swaps cannot overfill dispatch or empty the general quota', () => {
  const api = engine([...Array(3).fill('일반직'), ...Array(4).fill('파견직')]);
  const data = ['D', 'S', 'S', 'S', 'S', 'S', 'R'].map(role => [role]);
  const swap = api.findRestSwap(data, api.getScheduleDays(), api.state.employees, 1,
    [0, 0, 0, 0, 0, 0, 1], [0, 1, 0, 0, 0, 0, 0]);
  assert.equal(swap, null);
});

test('M repair cannot consume the last required general S', () => {
  const api = engine(Array(4).fill('일반직'));
  api.state.employees[1].mPool = true;
  const data = ['D', 'S', 'S', 'X'].map(role => [role]);
  assert.equal(api.findMRepairCandidate(data, api.getScheduleDays(), api.state.employees, 0, 'M1'), null);
});

test('forced rest and streak repair preserve weekend staffing and manual work', () => {
  for (const group of ['일반직', '파견직']) {
    const api = engine(Array(3).fill(group), { targetOffDays: 1, maxConsecutive: 1 });
    api.state.employees.forEach(employee => { employee.past = ['S', 'S', 'S', 'S']; });
    const data = (group === '일반직' ? ['D', 'S', 'S'] : ['S', 'S', 'S']).map(role => [role]);
    const original = JSON.stringify(data);
    api.forceExactTargetOff(data, api.getScheduleDays(), api.state.employees);
    api.enforceMaxConsecutive(data, api.getScheduleDays(), api.state.employees);
    assert.equal(JSON.stringify(data), original);
  }
});

test('manual over-capacity stays protected and is reported without further additions', () => {
  const api = engine(Array(5).fill('파견직'));
  api.state.employees.slice(0, 4).forEach(employee => {
    api.state.schedule[employee.id] = { '2026-10-10': 'S' };
    api.state.manual[employee.id + '|2026-10-10'] = true;
  });
  api.generateSchedule();
  const roles = api.state.employees.map(employee => api.state.schedule[employee.id]['2026-10-10']);
  assert.deepEqual(roles.slice(0, 4), ['S', 'S', 'S', 'S']);
  assert.equal(roles[4], 'R');
  assert.ok(api.validateSchedule().some(issue => issue.title === '토/일 파견직 출근 초과'));
});

test('monthly generation preserves quotas, X and manual R over multiple seeds', () => {
  const groups = [...Array(12).fill('일반직'), ...Array(4).fill('전문직'), ...Array(5).fill('파견직')];
  for (const [startDate, endDate] of [['2026-02-01', '2026-02-28'], ['2026-07-01', '2026-07-31'], ['2026-10-01', '2026-10-31']]) {
    for (const shuffleSeed of ['1', '2', '3']) {
      const api = engine(groups, { startDate, endDate, shuffleSeed, targetOffDays: 8, holidays: [startDate] });
      api.state.employees.forEach((employee, i) => {
        if (i < 16) Object.assign(employee, { nwPool: true, hPool: true, dPool: true, pPool: true });
      });
      const [first, second] = api.state.employees;
      api.state.schedule[first.id] = { [startDate]: 'X' };
      api.state.schedule[second.id] = { [startDate]: 'R' };
      api.state.manual[second.id + '|' + startDate] = true;
      api.generateSchedule();
      assert.equal(api.state.schedule[first.id][startDate], 'X');
      assert.equal(api.state.schedule[second.id][startDate], 'R');
      for (const day of api.getScheduleDays()) {
        if (![0, 6].includes(day.getDay())) continue;
        const date = [day.getFullYear(), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0')].join('-');
        const roles = api.state.employees.map(employee => api.state.schedule[employee.id][date]);
        assert.equal(roles.slice(0, 16).filter(role => ['D', 'S', 'SS'].includes(role)).length, 3, `${date} seed ${shuffleSeed} general`);
        assert.equal(roles.slice(16).filter(role => !['R', 'X', 'XS', 'A', 'W', ''].includes(role)).length, day.getDay() === 0 ? 2 : 3, `${date} seed ${shuffleSeed} dispatch`);
      }
      assert.ok(!api.validateSchedule().some(issue => issue.title.startsWith('토/일 ')));
    }
  }
});
