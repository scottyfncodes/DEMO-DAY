import type { App, ScreenInstance } from '../../app';
import { formatMoney, formatPercent } from '../../core/format';
import { CONTRACTS, nextContract } from '../../data/contracts';
import { isUnlocked } from '../../game/progression';
import { countUp } from '../count';
import { h, wait } from '../dom';

const OUTCOME_LABEL: Record<string, string> = {
  standing: 'still standing',
  resting: 'left on the structure',
  fallen: 'came down',
  destroyed: 'destroyed',
};

/**
 * Two-stage results screen: the demolition report (numbers reveal one by
 * one), then the payout (contract value, bonuses, then the total lands).
 */
export function reportScreen(app: App): ScreenInstance {
  const result = app.lastResult;
  if (!result) {
    app.go('menu');
    return { el: h('div') };
  }
  const { contract, report, payout, outcome, simResult, building } = result;
  const instant = app.reducedMotion;
  let disposed = false;
  let skip = false;
  const el = h('section', { class: 'screen scroll report' });
  el.addEventListener('pointerdown', () => {
    skip = true;
  });

  const pause = async (ms: number): Promise<void> => {
    if (instant || skip) return;
    await wait(ms);
  };

  // ------------------------------------------------------------ report
  const renderReport = async (): Promise<void> => {
    const rows: Array<{ el: HTMLElement; met?: boolean }> = [];
    const row = (label: string, sub: string | undefined, value: string, valueSub?: string, met?: boolean): HTMLElement => {
      const r = h(
        'div',
        { class: `rrow${met === undefined ? '' : met ? ' met' : ' missed'}` },
        h('div', { class: 'k' }, label, sub ? h('small', { text: sub }) : null),
        h('div', { class: 'v' }, value, valueSub ? h('small', { text: valueSub }) : null),
      );
      rows.push({ el: r, met });
      return r;
    };
    const destruction = report.requirements.find((r) => r.id === 'destruction');
    const collateral = report.requirements.find((r) => r.id === 'collateral');
    const footprint = report.requirements.find((r) => r.id === 'footprint');
    const protectedReq = report.requirements.find((r) => r.id === 'protected');

    const list = h(
      'div',
      { class: 'report-rows' },
      row('Structure Removed', `Required ${formatPercent(report.required, 0)}`, formatPercent(report.removed), destruction?.met ? 'Requirement met' : 'Below requirement', destruction?.met),
      row('Collateral Damage', `Maximum ${formatPercent(report.maxCollateral, 0)}`, formatPercent(report.collateral), collateral?.met ? 'Within limit' : 'Over the limit', collateral?.met),
      row('Target Footprint', footprint ? `Required ${formatPercent(report.targetFootprint, 0)}` : `Target ${formatPercent(report.targetFootprint, 0)}`, formatPercent(report.footprint, 0), footprint ? (footprint.met ? 'Debris in zone' : 'Debris outside zone') : report.footprint >= report.targetFootprint ? 'Bonus earned' : undefined, footprint ? footprint.met : undefined),
      protectedReq ? row('Protected Structure', undefined, protectedReq.value, protectedReq.met ? 'Untouched' : 'Damaged', protectedReq.met) : null,
      row('Charges Used', undefined, `${report.chargesUsed} / ${report.chargesAvailable}`, report.chargesUsed < report.chargesAvailable ? `${report.chargesAvailable - report.chargesUsed} returned` : 'All used'),
      row('Structural Efficiency', 'Share brought down by gravity, not explosives', formatPercent(report.efficiency, 0), report.efficiency >= 0.6 ? 'Bonus earned' : undefined),
    );

    const standing = Object.entries(simResult.memberOutcome)
      .filter(([, o]) => o === 'standing' || o === 'resting')
      .map(([id, o]) => `${building.members.get(id)?.label ?? id} (${OUTCOME_LABEL[o]})`);
    const neighborHits = Object.entries(report.neighborHits).filter(([, v]) => v > 0.05).map(([id]) => building.def.neighbors?.find((n) => n.id === id)?.label ?? id);
    const notes = h('div', { class: 'outcome-list' });
    if (standing.length) notes.append(h('div', {}, h('b', { text: 'Left standing: ' }), standing.slice(0, 6).join(', ') + (standing.length > 6 ? ` and ${standing.length - 6} more` : '')));
    else notes.append(h('div', {}, h('b', { text: 'Nothing left standing.' })));
    if (neighborHits.length) notes.append(h('div', {}, h('b', { text: 'Debris hit: ' }), neighborHits.join(', ')));
    if (!report.success) {
      const failed = report.requirements.filter((r) => !r.met).map((r) => r.label.toLowerCase());
      notes.append(h('div', {}, h('b', { text: 'Why it failed: ' }), `missed ${failed.join(' and ')}. Adjust the plan and try again.`));
    }

    const continueButton = h('button', { class: 'btn btn-primary btn-block', style: 'visibility:hidden', onClick: () => void renderPayout() }, 'Continue to payout');
    el.replaceChildren(
      h(
        'div',
        { class: 'report-title' },
        h('div', { class: 'kicker', text: `Job ${String(contract.jobNumber).padStart(2, '0')} · ${contract.title}` }),
        h('h2', { class: report.success ? 'ok' : 'fail', text: report.success ? 'Demolition Complete' : 'Contract Incomplete' }),
      ),
      list,
      notes,
      h('div', { class: 'footer-actions' }, continueButton),
    );
    app.play(report.success ? 'unlock' : 'fail');
    for (const r of rows) {
      await pause(380);
      if (disposed) return;
      r.el.classList.add('in');
      app.play(r.met === false ? 'error' : 'reveal');
    }
    continueButton.style.visibility = '';
    skip = false;
  };

  // ------------------------------------------------------------ payout
  const renderPayout = async (): Promise<void> => {
    skip = false;
    const valueEl = h('div', { class: `value${payout.success ? '' : ' partial'}`, text: formatMoney(0) });
    const bonusList = h('div', { class: 'bonus-list' });
    const totalValue = h('div', { class: 'value', text: formatMoney(0) });
    const total = h('div', { class: 'total' }, h('div', { class: 'label', text: 'Total Payout' }), totalValue);
    const buttons = h('div', { class: 'footer-actions', style: 'visibility:hidden' });
    const next = nextContract(contract.id);
    if (report.success && next && isUnlocked(next, app.save)) {
      buttons.append(h('button', { class: 'btn btn-primary btn-block', onClick: () => { app.play('select'); app.go('contract', { id: next.id }); } }, `Next Contract · ${next.title}`));
    }
    buttons.append(
      h('button', { class: `btn ${report.success ? '' : 'btn-primary'} btn-block`, onClick: () => { app.play('arm'); app.go('job', { id: contract.id }); } }, report.success ? 'Retry · Beat this payout' : 'Try again'),
      h('div', { class: 'menu-grid' }, h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('contracts'); } }, 'Contracts'), h('button', { class: 'btn', onClick: () => { app.play('tap'); app.go('menu'); } }, 'Main Menu')),
    );
    el.className = 'screen scroll payout';
    el.replaceChildren(
      h('div', { class: 'label', text: payout.success ? 'Contract Value' : 'Partial Payment · Contract Incomplete' }),
      valueEl,
      bonusList,
      total,
      buttons,
    );

    const dur = (ms: number): number => (instant || skip ? 0 : ms);
    let tick = 0;
    await countUp(0, payout.base, dur(1100), (v, t) => {
      valueEl.textContent = formatMoney(v);
      if (t < 1 && ++tick % 3 === 0) app.play('countTick', t);
    });
    if (disposed) return;
    let running = payout.base;
    for (const b of payout.bonuses) {
      await pause(420);
      if (disposed) return;
      bonusList.append(
        h('div', { class: 'bonus' }, h('div', { class: 'k' }, b.label, h('small', { text: b.detail })), h('div', { class: 'v', text: `+${formatMoney(b.amount)}` })),
      );
      app.play('bonus');
      app.buzz(10);
      running += b.amount;
    }
    if (!payout.success && payout.bonuses.length === 0) {
      bonusList.append(h('div', { class: 'hint', style: 'text-align:center;padding:10px', text: 'No bonuses on an incomplete contract. Full value and bonuses pay out when every requirement is met.' }));
    }
    await pause(500);
    if (disposed) return;
    total.classList.add('in');
    tick = 0;
    await countUp(0, running, dur(1400), (v, t) => {
      totalValue.textContent = formatMoney(v);
      if (t < 1 && ++tick % 2 === 0) app.play('countTick', t);
    });
    if (disposed) return;
    totalValue.textContent = formatMoney(payout.total);
    if (payout.success) {
      app.play('total');
      app.buzz([40, 30, 80]);
      if (!instant) {
        total.classList.add('shake');
        window.setTimeout(() => total.classList.remove('shake'), 500);
      }
      const badges: string[] = [];
      if (outcome.newRecords.includes('payout')) badges.push('New best payout');
      if (outcome.firstCompletion) badges.push('First completion');
      if (outcome.newRecords.includes('charges')) badges.push('Fewest charges');
      if (outcome.unlocked.length) badges.push(`Unlocked: ${outcome.unlocked.map((c) => c.title).join(', ')}`);
      if (badges.length) total.append(h('span', { class: 'pill ok record', text: badges.join(' · ') }));
      else total.append(h('span', { class: 'pill record', text: `Best on this job: ${formatMoney(app.save.records[contract.id]?.bestPayout ?? payout.total)}` }));
    } else {
      app.play('fail');
    }
    const done = app.save.completed.length;
    if (done === CONTRACTS.length && report.success) {
      total.append(h('div', { class: 'hint', style: 'margin-top:10px', text: 'Every contract on the board is complete. Now beat your own payouts.' }));
    }
    buttons.style.visibility = '';
  };

  void renderReport();
  return {
    el,
    destroy: () => {
      disposed = true;
    },
  };
}
