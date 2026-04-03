/* ============================================
   PADEL CHAMPAGNE — Main JavaScript
   Navigation, animations, mobile menu
   ============================================ */

document.addEventListener('DOMContentLoaded', function () {

  // ---------- Mobile Hamburger Menu ----------
  var toggle = document.getElementById('navbarToggle');
  var menu = document.getElementById('navbarMenu');

  if (toggle && menu) {
    toggle.addEventListener('click', function () {
      toggle.classList.toggle('active');
      menu.classList.toggle('open');
    });

    menu.querySelectorAll('.navbar-link').forEach(function (link) {
      link.addEventListener('click', function () {
        toggle.classList.remove('active');
        menu.classList.remove('open');
      });
    });

    document.addEventListener('click', function (e) {
      if (!menu.contains(e.target) && !toggle.contains(e.target)) {
        toggle.classList.remove('active');
        menu.classList.remove('open');
      }
    });
  }

  // ---------- Navbar background on scroll ----------
  var navbar = document.getElementById('navbar');
  if (navbar) {
    window.addEventListener('scroll', function () {
      if (window.scrollY > 50) {
        navbar.style.background = 'rgba(8, 8, 8, 0.97)';
      } else {
        navbar.style.background = 'rgba(8, 8, 8, 0.9)';
      }
    });
  }

  // ---------- Fade-in on scroll ----------
  var fadeElements = document.querySelectorAll('.fade-in');

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.1,
      rootMargin: '0px 0px -40px 0px'
    });

    fadeElements.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    fadeElements.forEach(function (el) {
      el.classList.add('visible');
    });
  }

});
