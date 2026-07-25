export function ConsoleUnavailablePanel() {
  return (
    <section className="rounded-[24px] border border-[#333333] bg-[#202020] p-8 text-white">
      <p className="text-[18px] font-semibold leading-[24px]">
        Console data unavailable
      </p>
      <p className="mt-3 max-w-[620px] text-[15px] leading-[22px] text-[#b8b8b8]">
        The Console BFF is not configured or did not return data. Configure the
        BFF connection and refresh this page; production Console pages do not
        fall back to fixture data.
      </p>
    </section>
  )
}
