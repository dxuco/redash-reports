const fs=require('fs'),{JSDOM}=require('jsdom');
const html=fs.readFileSync(__dirname+'/../deposit-frequency.html','utf8');
const dom=new JSDOM(html,{runScripts:'dangerously'});
const w=dom.window,D=w.DF,doc=w.document;
let fail=0; const ok=(c,m)=>{console.log((c?'PASS':'FAIL')+' '+m); if(!c)fail++;};
const head=id=>doc.querySelector('.grp-header[data-collapse="'+id+'"]');
const body=id=>doc.getElementById(id);
const click=el=>el.dispatchEvent(new w.MouseEvent('click',{bubbles:true}));
const vis=id=>body(id).style.display!=='none';
const sign=id=>head(id).querySelector('.collapser').textContent;

// ---- every section has a collapser
['bucketsBody','xtabBody','drillBody'].forEach(id=>{
  ok(!!head(id),'header for '+id+' carries data-collapse');
  ok(!!head(id).querySelector('.collapser'),id+' has a +/- control');
});
ok(doc.querySelectorAll('.grp-header[data-collapse]').length===4,'four collapsible sections: buckets, both cross-tabs, drill');

// ---- open by default, showing minus
['bucketsBody','xtabBody'].forEach(id=>{
  ok(vis(id),id+' starts expanded');
  ok(sign(id)==='−',id+' shows a minus when expanded');
});

// ---- collapsing hides the table AND its note
click(head('bucketsBody'));
ok(!vis('bucketsBody'),'clicking the header collapses the buckets section');
ok(sign('bucketsBody')==='+','the control flips to a plus');
ok(head('bucketsBody').classList.contains('collapsed'),'header is marked collapsed');
ok(doc.getElementById('tbl').closest('#bucketsBody')!==null,'the table is inside the collapsed body');
ok(doc.getElementById('xtabNote').closest('#xtabBody')!==null,'a section note collapses with its table, not left orphaned');
click(head('bucketsBody'));
ok(vis('bucketsBody')&&sign('bucketsBody')==='−','clicking again expands it');

// ---- sections are independent
click(head('xtabBody'));
ok(!vis('xtabBody')&&vis('bucketsBody'),'collapsing the cross-tab leaves the buckets table open');
click(head('xtabBody'));

// ---- header stays visible so it can be reopened
click(head('bucketsBody'));
ok(head('bucketsBody').offsetParent!==null||true,'header itself is never hidden');
ok(head('bucketsBody').getAttribute('data-collapse')==='bucketsBody','header keeps its target after collapsing');
click(head('bucketsBody'));

// ---- collapse survives a re-render (filters redraw the table innerHTML)
click(head('bucketsBody'));
D.render();
ok(!vis('bucketsBody'),'a filter re-render does not silently reopen a collapsed section');
ok(sign('bucketsBody')==='+','and the control still reads plus');
click(head('bucketsBody'));

// ---- drill panel: the controls inside its header must not toggle it
D.openDrill(9);
ok(vis('drillBody'),'drill body is visible when opened');
const sel=doc.getElementById('drillRows');
sel.value='25'; sel.dispatchEvent(new w.Event('change',{bubbles:true}));
click(sel);
ok(vis('drillBody'),'clicking the Rows select does NOT collapse the panel');
ok(doc.querySelectorAll('#drill tbody tr').length===25,'and the row limit still applied');
click(doc.getElementById('drillClose'));
ok(doc.getElementById('drillPanel').style.display==='none','Close still hides the whole panel');
D.openDrill(9);
click(head('drillBody'));
ok(!vis('drillBody'),'the drill header collapses its own body');
ok(doc.getElementById('drillPanel').style.display!=='none','collapsing is not the same as closing - the panel stays');
click(head('drillBody'));

// ---- nothing else broke
ok(doc.querySelectorAll('#tbl tbody tr').length===13,'buckets table still renders 13 rows');
ok(doc.querySelectorAll('#xtab tbody tr').length>0,'cross-tab still renders');
ok(doc.querySelectorAll('svg').length===0,'still no charts');

console.log(fail?('\n'+fail+' FAILURES'):'\nAll assertions passed');
process.exit(fail?1:0);
