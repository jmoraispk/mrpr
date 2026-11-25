// The landing page's only script: theme toggle and feature tabs. It is a
// file, not inline, so the page's policy can allow our own scripts and
// nothing else.
(function(){
  var page=document.getElementById('page'), btn=document.getElementById('theme-toggle');
  function setTheme(t){page.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';btn.setAttribute('aria-label',l);btn.setAttribute('title',l);document.body.style.background=t==='dark'?'#0F1218':'#F4F4F0';}
  setTheme(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  btn.addEventListener('click',function(){setTheme(page.getAttribute('data-theme')==='dark'?'light':'dark');});
  document.querySelectorAll('[data-tab]').forEach(function(b){
    b.addEventListener('click',function(){
      var id=b.dataset.tab;
      document.querySelectorAll('[data-pane]').forEach(function(p){p.style.display=p.dataset.pane===id?'flex':'none';});
      document.querySelectorAll('[data-tab]').forEach(function(x){var on=x.dataset.tab===id;x.style.background=on?'var(--ink)':'transparent';x.style.color=on?'var(--paper)':'var(--ink)';x.style.borderColor=on?'var(--ink)':'var(--line)';x.setAttribute('aria-pressed',on?'true':'false');});
    });
  });
})();
