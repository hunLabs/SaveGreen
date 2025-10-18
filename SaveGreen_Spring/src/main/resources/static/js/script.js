$(function(){
  // let lastScrollTop = 0;
  // const delta = 15;
  // let scrollBlocked = false; // 스크롤 카운트 중복 방지용

  // // ① 헤더 숨김/보임
  // $(window).on('scroll', function(){
  //   const st = $(this).scrollTop();

  //   // 너무 작은 스크롤은 무시
  //   if(Math.abs(lastScrollTop - st) <= delta) return;

  //   // 내릴 때 → 숨김
  //   if(st > lastScrollTop && st > 0){
  //     $('.navbar').addClass('nav-up');
  //   } else {
  //     // 올릴 때 → 다시 보이기
  //     $('.navbar').removeClass('nav-up');
  //   }

  //   lastScrollTop = st;
  // });

  // ② scroll-snap 자동 스크롤 (한 번만 반응)
  window.addEventListener('wheel', function(e) {
    if (scrollBlocked) return; // 이미 동작 중이면 무시
    scrollBlocked = true;

    // 휠 방향 감지
    const direction = e.deltaY > 0 ? 1 : -1;
    const nextPos = window.scrollY + (direction * window.innerHeight);

    // 부드럽게 이동
    window.scrollTo({ top: nextPos, behavior: 'smooth' });

    // 일정 시간 후 다시 허용
    setTimeout(() => { scrollBlocked = false; }, 800);
  }, { passive: true });
});


let lastScrollTop = 0;
const navbar = document.querySelector('.navbar');
const line = document.querySelector('.lineHR');
const container = document.querySelector('.container');

container.addEventListener('scroll', () => {
  const st = container.scrollTop;
  if (st > lastScrollTop + 5) {
    navbar.classList.add('nav-up');
    line.classList.add('lineHR-up');
  } else if (st < lastScrollTop - 5) {
    navbar.classList.remove('nav-up');
    line.classList.remove('lineHR-up');
  }


  lastScrollTop = st;
});

// 모든 next_show 요소 선택
const banners = document.querySelectorAll('.main-banner');

const options = {
  root: null,          // 브라우저 viewport
  rootMargin: '0px',
  threshold: 0.5       // 50% 이상 보이면 활성
};

const observer = new IntersectionObserver((entries, observer) => {
  entries.forEach(entry => {
    const nextShow = entry.target.querySelector('[class^="next_show"]'); // next_show0~3
    if (entry.isIntersecting) {
      entry.target.classList.add('active');   // 배너 활성화
      if (nextShow) nextShow.style.opacity = 1;
    } else {
      entry.target.classList.remove('active');
      if (nextShow) nextShow.style.opacity = 0;
    }
  });
}, options);

// 각 배너에 관찰자 등록
banners.forEach(banner => observer.observe(banner));

document.addEventListener("scroll", function() {
    const banners = document.querySelectorAll(".main-banner");

    banners.forEach((banner) => {
        const rect = banner.getBoundingClientRect();
        const showElements = banner.querySelectorAll(".next_show0, .next_show1, .next_show2, .next_show3");

        // 섹션이 화면의 1/3 이상 보이면 active 추가
        if (rect.top < window.innerHeight * 0.7 && rect.bottom > 0) {
            banner.classList.add("active");
        } else {
            banner.classList.remove("active");
        }
    });
});

