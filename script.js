const header = document.querySelector('.site-header');
const menuButton = document.querySelector('.menu-toggle');
const mobileMenu = document.querySelector('.mobile-menu');
const cursorLight = document.querySelector('.cursor-light');

window.addEventListener('scroll', () => {
  header.classList.toggle('scrolled', window.scrollY > 24);
});

menuButton.addEventListener('click', () => {
  const open = menuButton.classList.toggle('active');

  mobileMenu.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
});

mobileMenu.querySelectorAll('a').forEach((link) => {
  link.addEventListener('click', () => {
    menuButton.classList.remove('active');
    mobileMenu.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
  });
});

window.addEventListener('pointermove', (event) => {
  cursorLight.style.left = `${event.clientX}px`;
  cursorLight.style.top = `${event.clientY}px`;
});

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        revealObserver.unobserve(entry.target);
      }
    });
  },
  {
    threshold: 0.16
  }
);

document.querySelectorAll('.reveal').forEach((element) => {
  revealObserver.observe(element);
});

document.querySelectorAll('.magnetic').forEach((button) => {
  button.addEventListener('pointermove', (event) => {
    const box = button.getBoundingClientRect();
    const x = event.clientX - box.left - box.width / 2;
    const y = event.clientY - box.top - box.height / 2;

    button.style.transform = `translate(${x * 0.08}px, ${y * 0.08}px)`;
  });

  button.addEventListener('pointerleave', () => {
    button.style.transform = '';
  });
});

const canvas = document.getElementById('particle-canvas');
const context = canvas.getContext('2d');

let particles = [];
let pointer = {
  x: window.innerWidth / 2,
  y: window.innerHeight / 2
};

function resizeCanvas() {
  const deviceScale = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = window.innerWidth * deviceScale;
  canvas.height = window.innerHeight * deviceScale;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;

  context.setTransform(
    deviceScale,
    0,
    0,
    deviceScale,
    0,
    0
  );

  const particleCount = Math.min(
    105,
    Math.floor(window.innerWidth / 13)
  );

  particles = Array.from(
    {
      length: particleCount
    },
    () => ({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      radius: Math.random() * 1.25 + 0.25,
      speed: Math.random() * 0.18 + 0.04,
      drift: Math.random() * 0.24 - 0.12,
      alpha: Math.random() * 0.55 + 0.12
    })
  );
}

function animateParticles() {
  context.clearRect(
    0,
    0,
    window.innerWidth,
    window.innerHeight
  );

  particles.forEach((particle) => {
    particle.y -= particle.speed;
    particle.x += particle.drift;

    if (particle.y < -10) {
      particle.y = window.innerHeight + 10;
    }

    if (particle.x < -10) {
      particle.x = window.innerWidth + 10;
    }

    if (particle.x > window.innerWidth + 10) {
      particle.x = -10;
    }

    const xDistance = pointer.x - particle.x;
    const yDistance = pointer.y - particle.y;
    const distance = Math.hypot(xDistance, yDistance);

    if (distance < 150) {
      particle.x -= xDistance * 0.0008;
      particle.y -= yDistance * 0.0008;
    }

    context.beginPath();
    context.arc(
      particle.x,
      particle.y,
      particle.radius,
      0,
      Math.PI * 2
    );

    context.fillStyle = `rgba(255,255,255,${particle.alpha})`;
    context.fill();
  });

  requestAnimationFrame(animateParticles);
}

window.addEventListener('pointermove', (event) => {
  pointer.x = event.clientX;
  pointer.y = event.clientY;
});

window.addEventListener('resize', resizeCanvas);

resizeCanvas();
animateParticles();

const heroSymbol = document.querySelector('.hero-symbol');

window.addEventListener('pointermove', (event) => {
  if (window.innerWidth < 900) {
    return;
  }

  const x = (event.clientX / window.innerWidth - 0.5) * 16;
  const y = (event.clientY / window.innerHeight - 0.5) * 16;

  heroSymbol.style.translate = `${x}px ${y}px`;
});
