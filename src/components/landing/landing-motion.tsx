"use client";

import { useEffect } from "react";

/**
 * Page-level motion for the landing page: a sequenced hero entrance and restrained scroll reveals.
 * Content is visible without JavaScript; it is only hidden once this effect is about to animate it.
 */
export function LandingMotion() {
  useEffect(() => {
    const root = document.documentElement;
    if (!root.classList.contains("motion-ready")) return;
    root.dataset.motion = "on";
    let cancelled = false;
    let cleanup = () => {};

    // GSAP loads in its own chunk so it never delays first paint or hydration.
    Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
      .then(([{ gsap }, { ScrollTrigger }]) => {
        if (cancelled) return;
        gsap.registerPlugin(ScrollTrigger);
        const ctx = gsap.context(() => {
          const ease = "power3.out";
          const tl = gsap.timeline({ defaults: { ease } });
          tl.fromTo("[data-hero='line']", { yPercent: 105 }, { yPercent: 0, duration: 0.9, stagger: 0.12 })
            .fromTo("[data-hero='copy']", { y: 14 }, { y: 0, duration: 0.6 }, "-=0.55")
            .fromTo("[data-hero='cta']", { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.07 }, "-=0.4")
            .fromTo("[data-hero='stage']", { autoAlpha: 0, y: 70 }, { autoAlpha: 1, y: 0, duration: 1.1 }, "-=0.35");

          // Any [data-hero] element not covered above still needs revealing.
          gsap.set("[data-hero]:not([data-hero='bar']):not([data-hero='line']):not([data-hero='copy']):not([data-hero='cta']):not([data-hero='stage']):not(header)", {
            autoAlpha: 1,
          });

          const mm = gsap.matchMedia();
          mm.add("(min-width: 1024px)", () => {
            gsap.fromTo(
              "[data-window='listener']",
              { y: 40 },
              {
                y: -20,
                ease: "none",
                scrollTrigger: { trigger: "[data-stage]", start: "top bottom", end: "bottom top", scrub: 0.6 },
              },
            );
          });

          gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((el) => {
            const kids = el.querySelectorAll<HTMLElement>("[data-reveal-item]");
            gsap.fromTo(
              el,
              { autoAlpha: 0, y: 28 },
              {
                autoAlpha: 1,
                y: 0,
                duration: 0.8,
                ease,
                scrollTrigger: { trigger: el, start: "top 85%", once: true },
              },
            );
            if (kids.length) {
              gsap.fromTo(
                kids,
                { autoAlpha: 0, y: 18 },
                { autoAlpha: 1, y: 0, duration: 0.7, ease, stagger: 0.08, scrollTrigger: { trigger: el, start: "top 80%", once: true } },
              );
            }
          });
        });
        cleanup = () => {
          ctx.revert();
          ScrollTrigger.getAll().forEach((t) => t.kill());
        };
      })
      .catch(() => root.classList.remove("motion-ready"));

    return () => {
      cancelled = true;
      cleanup();
    };
  }, []);

  return null;
}
