import test from 'node:test';
import assert from 'node:assert/strict';
import { beginNavigationTraversal, browserNavigationRoute, initialNavigationTrail, localNavigationRoute, navigationDestination, navigationHistoryKey, navigationHistoryState, observeNavigationRoute, performNavigationTraversal, type NavigationTrail } from '../artifacts/fsp-signal/src/lib/app-navigation-trail';

const candidate = '371:candidate', employer = '372:employer';
const allowed = (route: string) => !['/', '/auth'].includes(route.split('?')[0]!);
const all = () => true;
const current = (trail: NavigationTrail) => trail.entries[trail.index];

function traverse(trail: NavigationTrail, direction: -1 | 1, acknowledgementFirst = false) {
  const destination = navigationDestination(trail, direction, allowed);
  const transition = beginNavigationTraversal(trail, direction, allowed);
  assert.ok(destination && transition, 'an enabled action has a distinct actual destination');
  assert.equal(destination.target, transition.target);
  assert.equal(current(transition.trail), transition.target, 'cursor and target are committed together before the router runs');
  let next = transition.trail;
  for (const kind of acknowledgementFirst ? ['render', 'replace'] as const : ['replace', 'render'] as const)
    next = observeNavigationRoute(next, trail.scope, transition.target, kind);
  assert.equal(next.pending, null);
  return next;
}

test('N-C01 resumes → passport → app Back → enabled Forward returns to passport in both acknowledgement orders', () => {
  for (const acknowledgementFirst of [false, true]) {
    const A = '/candidate/resumes', B = '/candidate/passport';
    let trail = observeNavigationRoute(initialNavigationTrail(candidate, A), candidate, B, 'push');
    for (let cycle = 0; cycle < 3; cycle++) {
      trail = traverse(trail, -1, acknowledgementFirst);
      assert.equal(current(trail), A);
      assert.deepEqual(trail.entries, [A, B], 'Back must not overwrite its forward destination');
      assert.deepEqual(navigationDestination(trail, 1, allowed), { target: B, index: 1 });
      trail = traverse(trail, 1, acknowledgementFirst);
      assert.equal(current(trail), B);
      assert.deepEqual(trail.entries, [A, B]);
    }
  }
});

test('N-C01 actual provider traversal command commits before synchronous history notifications in either listener order', () => {
  for (const renderFirst of [true, false]) {
    const events = new EventTarget(), A = '/candidate/resumes', B = '/candidate/passport';
    let trail = observeNavigationRoute(initialNavigationTrail(candidate, A), candidate, B, 'push');
    let location = B;
    const trace: string[] = [];
    const commit = (next: NavigationTrail) => { trail = next; trace.push(`commit:${current(next)}`); };
    const renderSubscriber = () => { trace.push(`render:${location}`); commit(observeNavigationRoute(trail, candidate, location, 'render')); };
    const historySubscriber = () => { trace.push(`replace:${location}`); commit(observeNavigationRoute(trail, candidate, location, 'replace')); };
    for (const listener of renderFirst ? [renderSubscriber, historySubscriber] : [historySubscriber, renderSubscriber]) events.addEventListener('replaceState', listener);
    const routerNavigate = (target: string) => {
      assert.equal(current(trail), target, 'the shared production command must synchronously commit its target before router notification');
      assert.equal(trail.pending?.target, target);
      trace.push(`navigate:${target}`); location = target;
      events.dispatchEvent(new Event('replaceState'));
    };
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const [direction, target] of [[-1, A], [1, B]] as const) {
        trace.length = 0;
        assert.equal(navigationDestination(trail, direction, allowed)?.target, target);
        assert.equal(performNavigationTraversal(trail, direction, allowed, commit, routerNavigate), target);
        assert.deepEqual(trace.slice(0, 2), [`commit:${target}`, `navigate:${target}`]);
        assert.equal(location, target); assert.equal(current(trail), target);
        assert.deepEqual(trail.entries, [A, B]); assert.equal(trail.pending, null);
      }
    }
  }
});

test('N-C01 employer settings and About traverse without discarding query-only entries', () => {
  const routes = ['/employer/jobs?tab=needs&q=Python', '/employer/jobs?tab=needs&q=SQL', '/settings?tab=company', '/about'];
  let trail = initialNavigationTrail(employer, routes[0]!);
  for (const route of routes.slice(1)) trail = observeNavigationRoute(trail, employer, route, 'push');
  for (let index = routes.length - 2; index >= 0; index--) { trail = traverse(trail, -1); assert.equal(current(trail), routes[index]); }
  for (const route of routes.slice(1)) { trail = traverse(trail, 1); assert.equal(current(trail), route); }
  assert.deepEqual(trail.entries, routes);
});

test('N-C01 repeated route names retain their distinct preceding and following screens', () => {
  const A = '/candidate/resumes', B = '/candidate/passport';
  let trail = initialNavigationTrail(candidate, A);
  for (const route of [B, A, '/settings']) trail = observeNavigationRoute(trail, candidate, route, 'push');
  for (const route of [A, B, A]) { trail = traverse(trail, -1); assert.equal(current(trail), route); }
  for (const route of [B, A, '/settings']) { trail = traverse(trail, 1); assert.equal(current(trail), route); }
  assert.deepEqual(trail.entries, [A, B, A, '/settings']);
});

test('N-C01 ordinary replace updates one slot; a new push after Back truncates only the forward branch', () => {
  let trail = initialNavigationTrail(candidate, '/candidate/resumes');
  trail = observeNavigationRoute(trail, candidate, '/candidate/jobs?page=1', 'push');
  trail = observeNavigationRoute(trail, candidate, '/candidate/jobs?page=2', 'replace');
  assert.deepEqual(trail.entries, ['/candidate/resumes', '/candidate/jobs?page=2']);
  trail = traverse(trail, -1);
  trail = observeNavigationRoute(trail, candidate, '/about', 'push');
  assert.deepEqual(trail.entries, ['/candidate/resumes', '/about']);
  assert.equal(navigationDestination(trail, 1, allowed), null);
  assert.equal(beginNavigationTraversal(trail, 1, allowed), null);
});

test('N-C01 native pop moves the local cursor without replacing entries or invoking logout', () => {
  let trail = initialNavigationTrail(candidate, '/candidate/resumes');
  for (const route of ['/candidate/passport?resumeId=42', '/about']) trail = observeNavigationRoute(trail, candidate, route, 'push');
  const entries = trail.entries;
  trail = observeNavigationRoute(trail, candidate, '/candidate/passport?resumeId=42', 'pop', trail.keys[1]);
  assert.equal(trail.index, 1); assert.equal(trail.entries, entries); assert.equal(trail.scope, candidate);
  trail = observeNavigationRoute(trail, candidate, '/about', 'pop', trail.keys[2]);
  assert.equal(trail.index, 2); assert.equal(trail.entries, entries);
  trail = observeNavigationRoute(trail, candidate, '/research', 'pop');
  assert.deepEqual(trail.entries, ['/research']); assert.equal(trail.index, 0);
});

test('N-C01 logout/login, account switch and same-user role switch discard the old scope and pending traversal', () => {
  let trail = observeNavigationRoute(initialNavigationTrail(candidate, '/candidate/resumes'), candidate, '/candidate/passport', 'push');
  trail = beginNavigationTraversal(trail, -1, allowed)!.trail;
  const guest = observeNavigationRoute(trail, 'visitor:public', '/', 'push');
  assert.deepEqual(guest, initialNavigationTrail('visitor:public', '/', trail.nextKey));
  assert.equal(navigationDestination(guest, 1, all), null);
  for (const scope of [candidate, '999:candidate', '371:employer']) {
    const route = scope.endsWith('employer') ? '/employer' : '/candidate';
    const next = observeNavigationRoute(guest, scope, route, 'replace');
    assert.deepEqual(next, initialNavigationTrail(scope, route, guest.nextKey));
    assert.equal(navigationDestination(next, -1, allowed), null);
  }
  assert.deepEqual(observeNavigationRoute(trail, '371:employer', '/employer', 'replace'), initialNavigationTrail('371:employer', '/employer', trail.nextKey));
});

test('N-C01 direct entry fallback stays local, commits one replacement and cannot add external history', () => {
  const trail = initialNavigationTrail(candidate, '/candidate/passport');
  for (const fallback of ['https://other.test', '//other.test', '/\\other.test', 'javascript:alert(1)', '/', '/auth'])
    assert.equal(beginNavigationTraversal(trail, -1, allowed, fallback), null);
  const back = beginNavigationTraversal(trail, -1, allowed, '/candidate')!;
  assert.equal(back.target, '/candidate');
  assert.deepEqual(back.trail.entries, ['/candidate']);
  assert.equal(current(observeNavigationRoute(back.trail, candidate, back.target, 'replace')), '/candidate');
  assert.equal(beginNavigationTraversal(trail, 1, allowed), null);
});

test('N-C01 normalized URLs and router base share one destination despite decoded Wouter search text', () => {
  const encoded = '/candidate/jobs?q=Python%20SQL&city=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C';
  assert.equal(localNavigationRoute('/candidate/jobs?q=Python SQL&city=Казань'), encoded);
  assert.equal(browserNavigationRoute({ pathname: '/signal/candidate/jobs', search: '?q=Python%20SQL&city=%D0%9A%D0%B0%D0%B7%D0%B0%D0%BD%D1%8C' }, '/signal'), encoded);
  assert.equal(browserNavigationRoute({ pathname: '/other/candidate', search: '' }, '/signal'), null);
  let trail = observeNavigationRoute(initialNavigationTrail(candidate, encoded), candidate, '/about', 'push');
  const move = beginNavigationTraversal(trail, -1, allowed)!;
  trail = observeNavigationRoute(move.trail, candidate, '/candidate/jobs?q=Python SQL&city=Казань', 'replace');
  assert.equal(trail.pending, null); assert.equal(trail.index, 0); assert.deepEqual(trail.entries, [encoded, '/about']);
});

test('N-C01 route normalization during traversal replaces only the selected destination', () => {
  let trail = initialNavigationTrail(candidate, '/candidate');
  trail = observeNavigationRoute(trail, candidate, '/about', 'push');
  trail = beginNavigationTraversal(trail, -1, allowed)!.trail;
  trail = observeNavigationRoute(trail, candidate, '/candidate/resumes', 'replace');
  assert.deepEqual(trail.entries, ['/candidate/resumes', '/about']);
  assert.equal(trail.pending, null);
  trail = traverse(trail, 1);
  assert.equal(current(trail), '/about');
});

test('N-C01 bounded history retains a usable cursor; selectors do not advertise duplicate no-op entries', () => {
  let trail = initialNavigationTrail(candidate, '/candidate/jobs?page=0');
  for (let page = 1; page < 100; page++) trail = observeNavigationRoute(trail, candidate, `/candidate/jobs?page=${page}`, 'push');
  assert.equal(trail.entries.length, 80); assert.equal(trail.index, 79);
  trail = traverse(trail, -1); assert.equal(current(trail), '/candidate/jobs?page=98');
  const duplicate = { ...initialNavigationTrail(candidate, '/about'), entries: ['/about', '/about', '/settings'], keys: [0, 1, 2], nextKey: 3 };
  assert.deepEqual(navigationDestination(duplicate, 1, allowed), { target: '/settings', index: 2 });
  assert.equal(beginNavigationTraversal(duplicate, 1, allowed)?.target, '/settings');
});

test('N-C01 native Forward selects the exact repeated URL occurrence, then app Forward reaches C', () => {
  const generation = 'mounted-session', A = '/candidate/resumes', B = '/candidate/passport', C = '/about';
  let trail = initialNavigationTrail(candidate, A);
  const browserEntries = [{ route: A, state: navigationHistoryState(null, generation, trail.keys[0]!) }];
  for (const route of [B, A, B, C]) {
    trail = observeNavigationRoute(trail, candidate, route, 'push');
    browserEntries.push({ route, state: navigationHistoryState(null, generation, trail.keys[trail.index]!) });
  }
  for (const browserIndex of [3, 2, 3]) {
    const entry = browserEntries[browserIndex]!;
    trail = observeNavigationRoute(trail, candidate, entry.route, 'pop', navigationHistoryKey(entry.state, generation));
    assert.equal(trail.index, browserIndex);
  }
  assert.equal(current(trail), B);
  assert.equal(navigationDestination(trail, 1, allowed)?.target, C);
  trail = traverse(trail, 1); assert.equal(current(trail), C);
});

test('N-C01 browser state fields survive tagging, old mount/unknown entries never guess a duplicate URL', () => {
  const state = { scroll: { x: 7, y: 21 }, modal: 'details', arbitrary: [1, 2] };
  const tagged = navigationHistoryState(state, 'session-a', 4);
  assert.deepEqual(state, { scroll: { x: 7, y: 21 }, modal: 'details', arbitrary: [1, 2] });
  assert.deepEqual((tagged as typeof state).scroll, state.scroll);
  assert.equal((tagged as typeof state).modal, state.modal);
  assert.deepEqual((tagged as typeof state).arbitrary, state.arbitrary);
  assert.equal(navigationHistoryKey(tagged, 'session-a'), 4);
  assert.equal(navigationHistoryKey(tagged, 'session-b'), null);
  assert.equal(navigationHistoryState(tagged, 'session-a', 4), tagged, 'no redundant replaceState');
  for (const unmodified of ['native string state', [1, 2], new Date(), { __signalAppNavigationV1: 'other owner' }]) {
    assert.equal(navigationHistoryState(unmodified, 'session-a', 4), unmodified);
    assert.equal(navigationHistoryKey(unmodified, 'session-a'), null);
  }
  let trail = initialNavigationTrail(candidate, '/candidate/resumes');
  for (const route of ['/candidate/passport', '/candidate/resumes', '/about']) trail = observeNavigationRoute(trail, candidate, route, 'push');
  const unknown = observeNavigationRoute(trail, candidate, '/candidate/resumes', 'pop', navigationHistoryKey(tagged, 'new-mount'));
  assert.deepEqual(unknown.entries, ['/candidate/resumes']);
  assert.ok(unknown.keys[0]! >= trail.nextKey, 'a reset must not reuse an old browser identity');
  assert.equal(navigationDestination(unknown, 1, allowed), null);
});

test('N-C01 live native ordering: early route render preserves the restored key before pop and the exact forward tail', () => {
  const generation = 'native-early-render', A = '/candidate/resumes', B = '/candidate/passport', C = '/settings';
  for (const renderFirst of [true, false]) {
    let trail = initialNavigationTrail(candidate, A);
    const browserEntries = [{ route: A, state: navigationHistoryState(null, generation, trail.keys[0]!) }];
    for (const route of [B, A, B, C]) {
      trail = observeNavigationRoute(trail, candidate, route, 'push');
      browserEntries.push({ route, state: navigationHistoryState(null, generation, trail.keys[trail.index]!) });
    }
    const originalEntries = trail.entries, originalKeys = trail.keys, originalNextKey = trail.nextKey;
    for (const browserIndex of [3, 2, 3]) {
      const entry = browserEntries[browserIndex]!;
      for (const phase of renderFirst ? ['render', 'pop'] as const : ['pop', 'render'] as const) {
        trail = observeNavigationRoute(trail, candidate, entry.route, phase, navigationHistoryKey(entry.state, generation));
        assert.equal(trail.index, browserIndex, `${phase} selects the original browser entry`);
        assert.equal(trail.entries, originalEntries, 'early rendering cannot append a false push or truncate the forward tail');
        assert.equal(trail.keys, originalKeys); assert.equal(trail.nextKey, originalNextKey);
        assert.equal(navigationHistoryState(entry.state, generation, trail.keys[trail.index]!), entry.state, 'no key rewrite before the delayed pop');
      }
      assert.equal(navigationDestination(trail, 1, allowed)?.target, browserIndex === 2 ? B : C);
    }
    let actualRoute = B;
    assert.equal(performNavigationTraversal(trail, 1, allowed, next => { trail = next; }, target => {
      actualRoute = target;
      trail = observeNavigationRoute(trail, candidate, target, 'render');
      trail = observeNavigationRoute(trail, candidate, target, 'replace');
    }), C);
    assert.equal(actualRoute, C); assert.equal(current(trail), C); assert.equal(trail.pending, null);
  }
});

test('N-C01 early render cannot classify unknown native entries as pushes or cancel an unacknowledged app traversal', () => {
  let trail = initialNavigationTrail(candidate, '/candidate/resumes');
  trail = observeNavigationRoute(trail, candidate, '/candidate/passport', 'push');
  for (const nativeKey of [null, 999, trail.keys[0]!]) {
    const early = observeNavigationRoute(trail, candidate, '/about', 'render', nativeKey);
    assert.equal(early, trail, 'wait for the actual history event; no invented cursor/key or state tag');
    const popped = observeNavigationRoute(early, candidate, '/about', 'pop', nativeKey);
    assert.deepEqual(popped.entries, ['/about']); assert.equal(popped.index, 0);
    assert.equal(navigationDestination(popped, 1, allowed), null);
  }
  const earlyPush = observeNavigationRoute(trail, candidate, '/settings', 'render');
  assert.equal(earlyPush, trail);
  assert.deepEqual(observeNavigationRoute(earlyPush, candidate, '/settings', 'push').entries, [...trail.entries, '/settings']);
  const pending = beginNavigationTraversal(trail, -1, allowed)!.trail;
  assert.equal(observeNavigationRoute(pending, candidate, '/candidate/passport', 'render', trail.keys[1]), pending);
  const acknowledged = observeNavigationRoute(pending, candidate, '/candidate/resumes', 'render');
  assert.equal(acknowledged.pending, null); assert.equal(acknowledged.index, 0);
  assert.deepEqual(acknowledged.entries, trail.entries);
});
