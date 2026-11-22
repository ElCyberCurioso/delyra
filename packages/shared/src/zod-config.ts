import { z } from "zod";

/**
 * Zod 4 comprueba al cargar si puede compilar validadores con `new Function` (modo JIT). Con la
 * CSP de las SPA sin `unsafe-eval` (F7-08) esa prueba solo genera un informe de violación, así
 * que se desactiva: los validadores funcionan igual, sin evaluar código.
 */
z.config({ jitless: true });
