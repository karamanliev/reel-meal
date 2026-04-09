import saladMascot from "../assets/images/salad.png";

export function Header() {
  return (
    <header className="w-full animate-bounce-in">
      <div className="neo-bar relative overflow-hidden px-4 py-3 pr-6 sm:px-5 sm:py-4 sm:pr-8">
        <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <div className="relative flex h-18 w-18 shrink-0 items-center justify-center sm:h-[5.25rem] sm:w-[5.25rem]">
              <img
                src={saladMascot}
                alt=""
                className="pointer-events-none h-16 w-auto object-contain sm:h-20"
              />
            </div>

            <h1 className="m-0 text-[2.9rem] leading-none sm:text-[3.9rem]">
              <span data-text="ReelMeal" className="neo-logo-text">
                ReelMeal
              </span>
            </h1>
          </div>

          <p className="m-0 text-[1.2rem] leading-[1.2] font-400 italic text-ink sm:text-[1.35rem]">
            From reels to meals
          </p>
        </div>
      </div>
    </header>
  );
}
