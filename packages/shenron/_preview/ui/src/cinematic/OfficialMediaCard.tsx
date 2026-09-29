"use client";

import React from "react";

export interface OfficialMediaCardProps {
  title: string;
  category: string;
  seriesTag?: "DB" | "DBZ" | "DBGT" | "DBS" | "DAIMA";
  imageUrl: string;
  href: string;
  date?: string;
  featured?: boolean;
  className?: string;
}

const SERIES_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  DB: { bg: "bg-amber-500", text: "text-amber-950", border: "border-amber-600" },
  DBZ: { bg: "bg-[#f85b00]", text: "text-white", border: "border-[#d84b00]" },
  DBGT: { bg: "bg-red-600", text: "text-white", border: "border-red-700" },
  DBS: { bg: "bg-sky-500", text: "text-white", border: "border-sky-600" },
  DAIMA: { bg: "bg-fuchsia-600", text: "text-white", border: "border-fuchsia-700" },
};

export const OfficialMediaCard: React.FC<OfficialMediaCardProps> = ({
  title,
  category,
  seriesTag,
  imageUrl,
  href,
  date,
  featured = false,
  className = "",
}) => {
  const seriesStyle = seriesTag ? SERIES_COLORS[seriesTag] : null;

  return (
    <a
      href={href}
      className={"group relative flex flex-col overflow-hidden bg-neutral-900 border-2 border-black rounded-lg transition-all duration-300 hover:-translate-y-1.5 hover:shadow-[0_8px_30px_rgba(248,91,0,0.35)] " + (featured ? "md:col-span-2 md:flex-row " : "") + className}
    >
      <div className={"relative overflow-hidden bg-neutral-950 " + (featured ? "md:w-3/5 min-h-[260px]" : "aspect-[16/9] w-full")}>
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover transition-transform duration-500 ease-out group-hover:scale-105"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
        {seriesTag && seriesStyle && (
          <div className="absolute top-3 left-3 z-10">
            <span className={"px-2.5 py-1 text-xs font-black uppercase tracking-wider rounded border " + seriesStyle.bg + " " + seriesStyle.text + " " + seriesStyle.border + " shadow-md"}>
              {seriesTag}
            </span>
          </div>
        )}
      </div>
      <div className={"flex flex-col justify-between p-4 " + (featured ? "md:w-2/5 p-6 md:border-l-4 md:border-[#f85b00]" : "") + " bg-neutral-900/90"}>
        <div>
          <div className="flex items-center justify-between text-xs mb-2">
            <span className="text-[#f85b00] font-bold uppercase tracking-[1.68px]">
              {category}
            </span>
            {date && <span className="text-neutral-400 font-mono text-[11px]">{date}</span>}
          </div>
          <h3 className={"font-black text-white leading-snug group-hover:text-[#f85b00] transition-colors " + (featured ? "text-xl md:text-2xl" : "text-base line-clamp-2")}>
            {title}
          </h3>
        </div>
        <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between text-xs text-neutral-400 group-hover:text-white transition-colors">
          <span className="font-semibold uppercase tracking-wider text-[11px]">Consulter</span>
          <span className="transform group-hover:translate-x-1.5 transition-transform duration-300 text-[#f85b00]">→</span>
        </div>
      </div>
    </a>
  );
};
