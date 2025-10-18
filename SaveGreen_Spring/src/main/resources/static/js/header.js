document.addEventListener('DOMContentLoaded', () => {
  let lastScrollTop = 0;
  const delta = 15;
  const navbar = document.querySelector('.navbar');
  const header = document.getElementById('menubar');
  const logo = document.querySelector('.logo_toggle');
  const menuToggle = document.querySelector('.menu-toggle');

  if (!navbar || !header) return;

  // 스크롤 대상 (window or .container)
  const scrollTarget = document.querySelector('.container') || window;
  const line = document.querySelector('.lineHR');

  // 헤더 숨김/보임 처리
  scrollTarget.addEventListener('scroll', () => {
    const st = scrollTarget.scrollTop || window.scrollY;

    if (Math.abs(lastScrollTop - st) <= delta) return;

    if (st > lastScrollTop && st > 0) {
      navbar.classList.add('nav-up');
      line.classList.add('lineHR-up');
    } else {
      navbar.classList.remove('nav-up');
      line.classList.remove('lineHR-up');
    }

    lastScrollTop = st;
  });

  // 모바일 메뉴 토글 (menu.svg 클릭 시)
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      navbar.classList.toggle('active');
    });
  }

  // 로고 클릭 시 메인 페이지 이동
  if (logo) {
    logo.addEventListener('click', () => {
      window.location.href = '/main';
    });
  }

  // 페이지별 헤더 배경색 변경
  const path = window.location.pathname;
  if (path.endsWith('main') || path === '/' || path === '') {
    header.style.backgroundColor = 'transparent';
  } else {
    header.style.backgroundColor = '#111';
  }

  header.style.transition = 'background-color 0.4s ease';
});
