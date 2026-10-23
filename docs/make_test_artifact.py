"""Turns docs/dietitian-partners-test.html into a published-artifact version
whose verdicts and notes save themselves to the artifact's db (every click,
no Save button), so a reload or a closed tab never loses a run and Claude can
read the results directly.

Run after build_dietitian_test.py:
  python3 docs/make_test_artifact.py
Writes docs/dietitian-partners-test.artifact.html
"""
import re

src = open("docs/dietitian-partners-test.html").read()

# Toolbar: no Save button; Load becomes Import (to restore a downloaded JSON).
src = src.replace('''  <button id="save" class="primary" type="button">Save results</button>
  <button id="load" type="button">Load results</button>''',
'''  <button id="load" type="button">Import file</button>''')
src = src.replace('<p class="saveline" id="saveline">Not saved yet. Press <b>Save results</b> and choose where to keep the file.</p>',
                  '<p class="saveline" id="saveline">Connecting…</p>')
src = src.replace('Press <strong>Save results</strong> to write them to a file on your computer.',
                  'Every click and every note <strong>saves itself</strong> straight away, on the server. Reloading or closing the tab loses nothing.')
src = src.replace('Press <strong>Save results</strong> as you go, then send me the JSON file or press <strong>Copy</strong> and paste it here.',
                  'Everything saves itself as you go, and I can read the results directly. Nothing to send.')

JS = r'''<script>
(function(){
  var wrap  = document.querySelector('.wrap');
  var NAME  = wrap.getAttribute('data-name') || 'test-pass';
  var CACHE = 'qa:' + NAME;
  var COLL  = 'runs/' + NAME + '/steps';       // db collection: one doc per step
  var steps = [].slice.call(document.querySelectorAll('.step'));
  var state = {};
  var db = null, live = false, pending = 0, lastSaved = null, failed = false;
  var noteTimers = {};

  function cacheRead(){ try { var v = localStorage.getItem(CACHE); return v ? JSON.parse(v) : null; } catch(e){ return null; } }
  function cacheWrite(){ try { localStorage.setItem(CACHE, JSON.stringify(state)); } catch(e){} }
  function stamp(html){ document.getElementById('saveline').innerHTML = html; }
  function status(){
    if (failed) { stamp('<b style="color:var(--fail)">Could not save the last change.</b> It is kept in this browser; it will save on your next click. If this repeats, press <b>Copy</b> and paste the text to Claude.'); return; }
    if (!db)    { stamp('Saving to the server is not available in this view, so results are kept in <b>this browser only</b>. Open the page from its link, or press <b>Copy</b> before closing.'); return; }
    if (pending){ stamp('Saving…'); return; }
    stamp(lastSaved ? 'All changes saved on the server · ' + lastSaved + '.' : 'Connected. Every click saves itself.');
  }
  function now(){ return new Date().toLocaleTimeString(); }

  async function writeStep(id){
    var s = state[id] || {};
    cacheWrite();
    if (!db) { status(); return; }
    pending++; status();
    try {
      await db.collection(COLL).doc(id).set({
        verdict: s.verdict || null, notes: s.notes || '',
        title: (document.querySelector('.step[data-id="' + id + '"] .step__t') || {}).textContent || '',
        updatedAt: new Date().toISOString()
      });
      failed = false; lastSaved = now();
    } catch(e){
      failed = true;
      if (e && e.code === 'unavailable') { setTimeout(function(){ writeStep(id); }, 1500 + Math.random()*1500); }
    } finally { pending--; status(); }
  }

  var VERDICTS = [['pass','PASS'],['fail','FAIL'],['blocked','BLOCKED']];
  steps.forEach(function(step){
    var id = step.getAttribute('data-id');
    var box = step.querySelector('.verdict');
    VERDICTS.forEach(function(v){
      var b = document.createElement('button');
      b.type='button'; b.setAttribute('data-v', v[0]); b.textContent = v[1];
      b.addEventListener('click', function(){
        var cur = (state[id] || {}).verdict;
        state[id] = state[id] || {};
        state[id].verdict = (cur === v[0]) ? null : v[0];
        paint(); writeStep(id);
      });
      box.appendChild(b);
    });
    var ta = document.createElement('textarea');
    ta.className = 'notes';
    ta.placeholder = 'Notes. What you saw, whether it repeats.';
    ta.addEventListener('input', function(){
      state[id] = state[id] || {};
      state[id].notes = ta.value;
      cacheWrite(); paint();
      clearTimeout(noteTimers[id]);
      noteTimers[id] = setTimeout(function(){ writeStep(id); }, 700);
    });
    ta.addEventListener('blur', function(){
      if (noteTimers[id]) { clearTimeout(noteTimers[id]); noteTimers[id] = null; writeStep(id); }
    });
    step.appendChild(ta);
  });

  function paint(){
    var p=0,f=0,b=0;
    steps.forEach(function(step){
      var id = step.getAttribute('data-id');
      var s  = state[id] || {};
      step.classList.remove('is-pass','is-fail','is-blocked');
      if (s.verdict) step.classList.add('is-' + s.verdict);
      if (s.verdict==='pass') p++;
      if (s.verdict==='fail') f++;
      if (s.verdict==='blocked') b++;
      step.querySelectorAll('.verdict button').forEach(function(btn){
        btn.classList.toggle('on', btn.getAttribute('data-v') === s.verdict);
      });
      var ta = step.querySelector('.notes');
      if (ta && document.activeElement !== ta) ta.value = s.notes || '';
    });
    document.getElementById('tp').textContent = p + ' pass';
    document.getElementById('tf').textContent = f + ' fail';
    document.getElementById('tb').textContent = b + ' blocked';
    document.getElementById('fill').style.width = (steps.length ? ((p+f+b)/steps.length*100) : 0) + '%';
  }

  function report(){
    var lines = [NAME, new Date().toLocaleString(), ''];
    var p=0,f=0,b=0,n=0;
    steps.forEach(function(step){
      var id = step.getAttribute('data-id'), s = state[id] || {};
      if (s.verdict==='pass') p++; else if (s.verdict==='fail') f++; else if (s.verdict==='blocked') b++; else n++;
      lines.push(id + '  ' + (s.verdict ? s.verdict.toUpperCase() : '--') + '  ' + step.querySelector('.step__t').textContent.trim());
      if ((s.notes||'').trim()) lines.push('      ' + s.notes.trim().replace(/\n/g, '\n      '));
    });
    lines.push('', p + ' pass, ' + f + ' fail, ' + b + ' blocked, ' + n + ' not run, of ' + steps.length + ' steps');
    return lines.join('\n');
  }

  // Import a results JSON saved by the old file-based version.
  document.getElementById('load').addEventListener('click', function(){
    var input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = function(){
      var file = input.files && input.files[0]; if (!file) return;
      var r = new FileReader();
      r.onload = async function(){
        var data; try { data = JSON.parse(String(r.result)); } catch(e){ stamp('That file is not readable JSON.'); return; }
        if (!data || !Array.isArray(data.steps)) { stamp('That file holds no results.'); return; }
        var ids = [];
        data.steps.forEach(function(row){
          if (!row || !row.id || !document.querySelector('.step[data-id="' + row.id + '"]')) return;
          state[row.id] = { verdict: row.verdict || null, notes: row.notes || '' }; ids.push(row.id);
        });
        paint();
        for (var i=0;i<ids.length;i++) { await writeStep(ids[i]); }
        stamp('Imported ' + ids.length + ' steps and saved them on the server.');
      };
      r.readAsText(file);
    };
    input.click();
  });

  document.getElementById('copy').addEventListener('click', function(){
    var btn = this, text = report(), out = document.getElementById('out');
    out.value = text; out.classList.add('show');
    out.focus(); out.setSelectionRange(0, text.length);
    var finish = function(ok){ btn.textContent = ok ? 'Copied' : 'Copy from the box'; setTimeout(function(){ btn.textContent = 'Copy'; }, 2600); };
    var legacy = function(){ try { return document.execCommand && document.execCommand('copy'); } catch(e){ return false; } };
    if (navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(function(){ finish(true); }, function(){ finish(legacy()); });
    } else { finish(legacy()); }
  });

  // Clear: two clicks within 4 s (no browser confirm dialogs in an embedded page).
  var armed = null;
  document.getElementById('reset').addEventListener('click', async function(){
    var btn = this;
    if (!armed) {
      btn.textContent = 'Click again to clear all';
      armed = setTimeout(function(){ armed = null; btn.textContent = 'Clear'; }, 4000);
      return;
    }
    clearTimeout(armed); armed = null; btn.textContent = 'Clear';
    var ids = Object.keys(state);
    state = {}; paint(); cacheWrite();
    for (var i=0;i<ids.length;i++) { await writeStep(ids[i]); }
    document.getElementById('out').classList.remove('show');
  });

  // Start from this browser's copy, then let the server copy win.
  var cached = cacheRead();
  if (cached) { state = cached; }
  paint(); status();

  var started = false;
  (async function(){
    try { db = window.claude && window.claude.use ? await window.claude.use('db') : null; } catch(e){ db = null; }
    if (!db) { status(); return; }
    db.collection(COLL).onSnapshot(function(snap){
      var server = {};
      snap.docs.forEach(function(d){ var v = d.data() || {}; server[d.id] = { verdict: v.verdict || null, notes: v.notes || '' }; });
      if (!started) {
        started = true;
        // First load: anything only in this browser (e.g. typed before the
        // server answered) is pushed up; otherwise the server copy wins.
        var local = state; state = server;
        Object.keys(local).forEach(function(id){
          var l = local[id] || {};
          if (!server[id] && (l.verdict || (l.notes||'').trim())) { state[id] = l; writeStep(id); }
        });
      } else {
        Object.keys(server).forEach(function(id){
          var ta = document.querySelector('.step[data-id="' + id + '"] .notes');
          if (ta && document.activeElement === ta) return; // don't clobber what you're typing
          state[id] = server[id];
        });
      }
      cacheWrite(); paint(); status();
    }, function(){ status(); });
    status();
  })();
})();
</script>'''

src = src.replace(".bar{position:sticky; top:0;", ".bar{position:sticky; top:env(safe-area-inset-top, 0px);")
src = re.sub(r'<script>\s*\(function\(\)\{.*?\}\)\(\);\s*</script>', lambda m: JS, src, flags=re.S)
assert 'COLL' in src
open("docs/dietitian-partners-test.artifact.html", "w").write(src)
print("ok")
