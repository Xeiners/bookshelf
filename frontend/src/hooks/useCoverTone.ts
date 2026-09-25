import { useEffect, useState } from 'react'
import { cachedTone, coverTone, fallbackTone } from '../lib/coverTone'
import type { Book } from '../types/book'

/**
 * Teinte dominante d'une couverture, réactive. Rend immédiatement la teinte en
 * cache (ou la teinte de secours), puis la vraie dès qu'elle est calculée.
 */
export function useCoverTone(book: Book): string {
  const [tone, setTone] = useState(() => cachedTone(book) ?? fallbackTone(book.id))

  useEffect(() => {
    let active = true
    void coverTone(book).then((value) => {
      if (active) setTone(value)
    })
    return () => {
      active = false
    }
  }, [book])

  return tone
}
