import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Une clases de Tailwind; si dos chocan (px-2 y px-4) gana la última. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
