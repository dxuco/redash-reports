const { JSDOM } = require('/tmp/jsdomtest/node_modules/jsdom');
const fs = require('fs');
const html = fs.readFileSync('/home/claude/ftd-dashboard/ftd-bonus-dashboard.html', 'utf8');

const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true });
const doc = dom.window.document;

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await wait(500);
  const win = dom.window;

  // basic sanity
  console.log('month options:', doc.getElementById('month').options.length);
  console.log('kpis element removed:', !doc.getElementById('kpis'));
  console.log('t-dep rows:', doc.querySelectorAll('#t-dep tbody tr').length);
  console.log('t-ggr rows:', doc.querySelectorAll('#t-ggr tbody tr').length);
  console.log('t-neg rows:', doc.querySelectorAll('#t-neg tbody tr').length);

  // print first row of each table
  ['t-dep','t-ggr','t-neg'].forEach(id => {
    const tr = doc.querySelector('#'+id+' tbody tr');
    console.log(id, 'first row:', tr ? tr.textContent.replace(/\s+/g,' ').trim() : 'NONE');
  });

  // switch month
  const monthSel = doc.getElementById('month');
  monthSel.value = '2026-01';
  monthSel.dispatchEvent(new win.Event('change'));
  await wait(100);
  console.log('after switching to 2026-01, t-dep rows:', doc.querySelectorAll('#t-dep tbody tr').length);
  console.log('t-dep first row (Jan):', doc.querySelector('#t-dep tbody tr').textContent.replace(/\s+/g,' ').trim());

  // switch status to Active
  const activeBtn = [...doc.querySelectorAll('#statusSeg button')].find(b => b.dataset.v === 'Active');
  activeBtn.click();
  await wait(100);
  console.log('after Active filter, t-dep rows:', doc.querySelectorAll('#t-dep tbody tr').length);

  // click a row to open modal
  monthSel.value = '2026-09';
  monthSel.dispatchEvent(new win.Event('change'));
  const allBtn = [...doc.querySelectorAll('#statusSeg button')].find(b => b.dataset.v === 'All');
  allBtn.click();
  await wait(100);
  const firstRow = doc.querySelector('#t-dep tbody tr');
  console.log('clicking row for pid:', firstRow.dataset.pid);
  firstRow.dispatchEvent(new win.MouseEvent('click', {bubbles:true}));
  await wait(100);
  const modal = doc.querySelector('.ovl');
  console.log('modal opened:', !!modal);
  if (modal) {
    console.log('modal uname:', doc.querySelector('.pop .uname').textContent);
    console.log('modal tots:', doc.querySelector('.pop .tots').textContent.replace(/\s+/g,' ').trim());
    console.log('modal day columns:', doc.querySelectorAll('.pop thead th').length - 1);
    console.log('modal bonus rows:', doc.querySelectorAll('.pop tbody tr').length - 2);
  }

  // sort test - click Deposit header on t-ggr
  const th = doc.querySelector('#t-ggr thead th[data-k="d"]');
  th.dispatchEvent(new win.MouseEvent('click', {bubbles:true}));
  await wait(100);
  console.log('t-ggr sorted by deposit, first row:', doc.querySelector('#t-ggr tbody tr').textContent.replace(/\s+/g,' ').trim());

  console.log('ALL TESTS COMPLETED');
})().catch(e => { console.error('ERROR', e); process.exit(1); });
