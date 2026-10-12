// The landing page's only script: theme toggle and feature tabs. It is a file,
// not inline, so the page's policy can allow our own scripts and nothing else.
(function(){
  var page=document.getElementById('page'), btn=document.getElementById('theme-toggle');
  function setTheme(t){page.setAttribute('data-theme',t);var l=t==='dark'?'Switch to light mode':'Switch to dark mode';btn.setAttribute('aria-label',l);btn.setAttribute('title',l);document.body.style.background=t==='dark'?'#0F1218':'#F4F4F0';}
  setTheme(window.matchMedia&&matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');
  btn.addEventListener('click',function(){setTheme(page.getAttribute('data-theme')==='dark'?'light':'dark');});
  document.querySelectorAll('[data-feature]').forEach(function(b){
    function go(){
      var id=b.dataset.feature;
      document.querySelectorAll('[data-pane]').forEach(function(p){p.style.display=p.dataset.pane===id?'flex':'none';});
      document.querySelectorAll('[data-feature]').forEach(function(x){var on=x.dataset.feature===id;x.style.background=on?'var(--paper)':'transparent';x.style.borderColor=on?'var(--ink)':'transparent';x.setAttribute('aria-pressed',on?'true':'false');var d=x.querySelector('[data-desc]');if(d)d.style.display=on?'block':'none';});
    }
    b.addEventListener('click',go);b.addEventListener('mouseenter',go);
  });
})();
