import type { App, ScreenInstance } from '../../app';
import { formatMoney, formatPercent } from '../../core/format';
import { CONTRACTS, nextContract } from '../../data/contracts';
import { missedBonuses } from '../../game/payout';
import { compareToBest, isUnlocked } from '../../game/progression';
import type { Requirement } from '../../game/scoring';
import { isNearPerfect } from '../../game/timeline';
import { countUp } from '../count';
import { h, wait } from '../dom';

const OUTCOME_LABEL: Record<string, string> = {
  standing: 'still standing',
  resting: 'left on the structure',
  fallen: 'came down',
  destroyed: 'destroyed',
};

/**
 * One continuous results sequence: the demolition report (numbers and
 * requirements reveal one by one), then the payout (contract value, bonuses
 * one at a time, the total lands), then the reason to run it again.
 * Tapping anywhere hurries the reveal along.
 */
export function reportScreen(app: App, params: Record<string, string> = {}): ScreenInstance {
  const result = app.lastResult;
  if (!result) {
    app.go('menu');
    return { el: h('div') };
  }
  const { contract, report, payout, outcome, simResult, building } = result;
  const instant = app.reducedMotion;
  let disposed = false;
  // Coming back from a replay: show the finished report straight away, quietly.
  const returning = params.instant === '1';
  let skip = returning;
  const sfx = (...args: Parameters<App['play']>): void => {
    if (!returning) app.play(...args);
  };
  const el = h('section', { class: 'screen scroll report' });
  el.addEventListener('pointerdown', () => {
    skip = true;
  });

  const fast = (): boolean => instant || skip;
  const pause = async (ms: number): Promise<void> => {
    if (fast()) return;
    await wait(ms);
  };
  const reveal = (node: HTMLElement): void => {
    node.classList.add('in');
    if (!fast()) node.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // ------------------------------------------------------------ report
  const row = (label: string, value: string, sub?: string, met?: boolean): HTMLElement =>
    h(
      'div',
      { class: `rrow${met === undefined ? '' : met ? ' met' : ' missed'}` },
      h('div', { class: 'k', text: label }),
      h('div', { class: 'v' }, h('span', { class: 'num', text: value }), sub ? h('small', { text: sub }) : null),
    );

  const destruction = report.requirements.find((r) => r.id === 'destruction');
  const collateral = report.requirements.find((r) => r.id === 'collateral');
  const rows: Array<{ el: HTMLElement; count?: { to: number; fmt: (v: number) => string } }> = [
    {
      el: row('Structure Removed', formatPercent(0, 0), `Required ${formatPercent(report.required, 0)}`, destruction?.met),
      count: { to: report.removed, fmt: (v) => formatPercent(v, v >= 0.995 ? 0 : 1) },
    },
    { el: row('Collateral', formatPercent(report.collateral), `Limit ${formatPercent(report.maxCollateral, 0)}`, collateral?.met) },
    {
      el: row('Charges Used', `${report.chargesUsed} / ${report.chargesAvailable}`, report.chargesUsed < report.chargesAvailable ? `${report.chargesAvailable - report.chargesUsed} returned` : 'All used'),
    },
    {
      el: row('Structural Efficiency', formatPercent(0, 0), 'Brought down by gravity'),
      count: { to: report.efficiency, fmt: (v) => formatPercent(v, 0) },
    },
  ];

  const requirementLabel = (r: Requirement): string => {
    switch (r.id) {
      case 'destruction':
        return report.required >= 0.95 ? 'Building cleared' : `${formatPercent(report.required, 0)} brought down`;
      case 'collateral':
        return (building.def.neighbors?.length ?? 0) > 0 ? 'Neighbours protected' : 'Collateral within limit';
      case 'footprint':
        return 'Debris in the landing zone';
      case 'protected':
        return 'Protected structure standing';
    }
  };
  const reqItems = report.requirements.map((r) =>
    h('li', { class: r.met ? 'met' : 'missed' }, h('span', { class: 'mark', text: r.met ? '✓' : '✗' }), requirementLabel(r), h('small', { text: `${r.value} · needs ${r.target}` })),
  );
  const reqList = h('ul', { class: 'reqs' }, ...reqItems);

  const notes = h('div', { class: 'outcome-list' });
  if (!report.success) {
    const standing = Object.entries(simResult.memberOutcome)
      .filter(([, o]) => o === 'standing' || o === 'resting')
      .map(([id, o]) => `${building.members.get(id)?.label ?? id} (${OUTCOME_LABEL[o]})`);
    const neighborHits = Object.entries(report.neighborHits)
      .filter(([, v]) => v > 0.05)
      .map(([id]) => building.def.neighbors?.find((n) => n.id === id)?.label ?? id);
    if (standing.length) notes.append(h('div', {}, h('b', { text: 'Left standing: ' }), standing.slice(0, 5).join(', ') + (standing.length > 5 ? ` and ${standing.length - 5} more` : '')));
    if (neighborHits.length) notes.append(h('div', {}, h('b', { text: 'Debris hit: ' }), neighborHits.join(', ')));
  }

  const clean = report.success && isNearPerfect(report.removed, report.efficiency);
  const header = h(
    'div',
    { class: 'report-title' },
    h('div', { class: 'kicker', text: `Demolition Report · Job ${String(contract.jobNumber).padStart(2, '0')}` }),
    h('h2', { class: report.success ? (clean ? 'ok clean' : 'ok') : 'fail', text: report.success ? contract.title : 'Contract Incomplete' }),
  );

  // ------------------------------------------------------------ payout
  const payoutBlock = h('div', { class: 'payout-block' });
  const valueLabel = h('div', { class: 'label', text: payout.success ? 'Contract Value' : 'Partial Payment' });
  const valueEl = h('div', { class: `value${payout.success ? '' : ' partial'}`, text: formatMoney(0) });
  const bonusList = h('div', { class: 'bonus-list' });
  const totalValue = h('div', { class: 'value', text: formatMoney(0) });
  const total = h('div', { class: 'total' }, h('div', { class: 'label', text: 'Total Payout' }), totalValue);
  const replay = h('div', { class: 'replay' });
  const buttons = h('div', { class: 'footer-actions' });

  el.replaceChildren(header, h('div', { class: 'report-rows' }, ...rows.map((r) => r.el)), reqList, notes, payoutBlock);

  const run = async (): Promise<void> => {
    sfx(report.success ? 'unlock' : 'fail');
    await pause(350);
    for (const r of rows) {
      if (disposed) return;
      reveal(r.el);
      sfx(r.el.classList.contains('missed') ? 'error' : 'reveal');
      if (r.count) {
        const num = r.el.querySelector('.num') as HTMLElement;
        const { to, fmt } = r.count;
        let tick = 0;
        await countUp(0, to, fast() ? 0 : 520, (v, t) => {
          num.textContent = fmt(v);
          if (t < 1 && ++tick % 4 === 0) sfx('countTick', t * 0.5);
        });
      }
      await pause(260);
    }
    for (const li of reqItems) {
      if (disposed) return;
      await pause(200);
      reveal(li);
      sfx(li.classList.contains('met') ? 'select' : 'error');
    }
    notes.classList.add('in');
    await pause(700);
    if (disposed) return;
    await runPayout();
  };

  const runPayout = async (): Promise<void> => {
    payoutBlock.append(valueLabel, valueEl, bonusList, total, replay, buttons);
    reveal(payoutBlock);
    let tick = 0;
    await countUp(0, payout.base, fast() ? 0 : 900, (v, t) => {
      valueEl.textContent = formatMoney(v);
      if (t < 1 && ++tick % 3 === 0) sfx('countTick', t);
    });
    if (disposed) return;
    sfx('reveal');
    for (const b of payout.bonuses) {
      await pause(380);
      if (disposed) return;
      const amount = h('div', { class: 'v', text: '+$0' });
      const line = h('div', { class: 'bonus' }, h('div', { class: 'k' }, b.label, h('small', { text: b.detail })), amount);
      bonusList.append(line);
      reveal(line);
      sfx('bonus');
      app.buzz(10);
      await countUp(0, b.amount, fast() ? 0 : 320, (v) => {
        amount.textContent = `+${formatMoney(v)}`;
      });
    }
    if (!payout.success) {
      bonusList.append(h('div', { class: 'hint', style: 'text-align:center;padding:10px', text: 'No bonuses on an incomplete contract. Meet every requirement for full value.' }));
    }
    await pause(450);
    if (disposed) return;
    reveal(total);
    tick = 0;
    await countUp(0, payout.total, fast() ? 0 : 1200, (v, t) => {
      totalValue.textContent = formatMoney(v);
      if (t < 1 && ++tick % 2 === 0) sfx('countTick', t);
    });
    if (disposed) return;
    totalValue.textContent = formatMoney(payout.total);
    const cmp = compareToBest(payout.total, outcome.previousBest, payout.success);
    if (payout.success) {
      sfx('total');
      sfx('cash');
      app.buzz([40, 30, 80]);
      if (!instant) {
        total.classList.add('shake');
        window.setTimeout(() => total.classList.remove('shake'), 500);
      }
      if (cmp.kind === 'new-best') {
        await pause(350);
        if (disposed) return;
        total.classList.add('best');
        total.append(h('div', { class: 'best-banner', text: 'New Best Payout' }));
        sfx('newBest');
        app.buzz([20, 30, 20, 30, 80]);
      }
      const badges: string[] = [];
      if (outcome.firstCompletion) badges.push('First completion');
      if (outcome.newRecords.includes('charges')) badges.push('Fewest charges');
      if (outcome.unlocked.length) badges.push(`Unlocked: ${outcome.unlocked.map((c) => c.title).join(', ')}`);
      if (badges.length) total.append(h('span', { class: 'pill ok record', text: badges.join(' · ') }));
    } else {
      sfx('fail');
    }
    await pause(400);
    if (disposed) return;
    renderReplay(cmp);
    reveal(replay);
    buttons.classList.add('in');
    // Back from a replay, land on the buttons: the next move is the point.
    if (!fast() || returning) buttons.scrollIntoView({ block: 'end', behavior: returning ? 'auto' : 'smooth' });
  };

  const renderReplay = (cmp: ReturnType<typeof compareToBest>): void => {
    const best = h('div', { class: 'cell' }, h('small', { text: 'Best Payout' }), h('b', { text: formatMoney(cmp.best) }));
    const now = h('div', { class: 'cell' }, h('small', { text: 'This Run' }), h('b', { text: formatMoney(payout.total) }));
    let line: string;
    switch (cmp.kind) {
      case 'first':
        line = 'First payout on this job. Now beat it.';
        break;
      case 'new-best':
        line = `+${formatMoney(cmp.delta)} over your old best`;
        break;
      case 'tied':
        line = 'Tied your best. One more bonus beats it.';
        break;
      case 'short':
        line = `+${formatMoney(cmp.delta)} needed to beat your best`;
        break;
      case 'failed':
        line = cmp.best > 0 ? `Your best here is ${formatMoney(cmp.best)}. Meet every requirement to get paid in full.` : 'Meet every requirement to get paid in full.';
        break;
    }
    replay.replaceChildren(h('div', { class: 'cells' }, best, now), h('div', { class: `gap ${cmp.kind}`, text: line }));
    const missed = missedBonuses(report, contract, payout).slice(0, 2);
    if (missed.length) {
      replay.append(
        h(
          'ul',
          { class: 'missed-bonuses' },
          ...missed.map((m) => h('li', {}, h('span', { text: m.tip }), h('b', { text: `+${formatMoney(m.potential)}` }))),
        ),
      );
    }

    const next = nextContract(contract.id);
    buttons.replaceChildren(
      h(
        'button',
        {
          class: 'btn btn-primary btn-block run-again',
          onClick: () => {
            app.play('arm');
            app.go('job', { id: contract.id, replay: '1' });
          },
        },
        report.success ? 'Run It Again' : 'Try Again',
      ),
    );
    if (app.lastPlan?.contractId === contract.id) {
      buttons.append(
        h(
          'button',
          {
            class: 'btn btn-block watch',
            onClick: () => {
              app.play('tap');
              app.go('job', { id: contract.id, watch: '1' });
            },
          },
          '▶ Watch the Replay',
        ),
      );
    }
    if (report.success && next && isUnlocked(next, app.save)) {
      buttons.append(h('button', { class: 'btn btn-block', onClick: () => { app.play('select'); app.go('contract', { id: next.id }); } }, `Next Job · ${next.title}`));
    }
    buttons.append(
      h('div', { class: 'menu-grid' }, h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('contracts'); } }, 'Contracts'), h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('menu'); } }, 'Main Menu')),
    );
    if (app.save.completed.length === CONTRACTS.length && report.success) {
      buttons.append(h('div', { class: 'hint', style: 'text-align:center', text: 'Every contract on the board is complete. Now beat your own payouts.' }));
    }
  };

  void run();
  return {
    el,
    destroy: () => {
      disposed = true;
    },
  };
}
