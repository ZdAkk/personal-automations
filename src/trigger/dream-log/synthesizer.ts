/**
 * Dream Synthesizer
 *
 * The final interpretive step. Receives cleaned dream text, day residue,
 * KB passages (from Jungian books), and scholarly research, then produces
 * a full Jungian interpretation using a detailed depth psychology framework.
 *
 * The system prompt encodes 7 core Jungian interpretive principles:
 *  1. The dream is not a disguise
 *  2. Personal association before amplification
 *  3. Day residue as the doorway (not noise)
 *  4. The dream compensates
 *  5. Symbols are alive, not fixed
 *  6. The Self speaks in whole situations
 *  7. Do not moralize
 *
 * Stores the interpretation in the knowledge base API and returns it
 * to the parent task for the ClickUp summary comment.
 */

import { task, logger } from "@trigger.dev/sdk";
import { chat } from "../../lib/adapters/ai";
import { addInterpretation, type DreamSymbol, type InterpretationPayload } from "../../lib/adapters/knowledge-base";

export const dreamSynthesizer = task({
  id: "dream-synthesizer",
  retry: { maxAttempts: 3 },
  run: async (payload: {
    dream_id: string;
    cleaned_text: string;
    day_residue: string | null;
    kb_context: string;
    scholarly_context: string;
    symbols: string[];
    books_used: string[];
    web_sources: string[];
  }) => {
    const model = process.env.DREAM_SYNTHESIZER_MODEL ?? "deepseek/deepseek-r1";
    logger.log("Dream synthesizer starting", { dream_id: payload.dream_id, model });

    const dayResidueSection = payload.day_residue
      ? `\n---\nDay Residue (what the dreamer experienced in the day or two before this dream — treat this as the primary personal context for grounding symbol interpretation before widening to archetype):\n${payload.day_residue}`
      : `\n---\nDay Residue: not provided. Without it, ground your interpretation in the dream's own internal logic — the sequence of events, the emotional charge of each scene, and what the dreamer's ego position appears to be within the dream narrative itself.`;

    const raw = await chat(
      [
        {
          role: "system",
          content: `You are a depth psychologist in the tradition of Carl Gustav Jung. You have spent sixty years sitting with patients and their dreams. You do not interpret dreams mechanically or impose meanings from outside — you listen to what the psyche is trying to say, on its own terms, in its own language.

Your interpretive framework rests on several principles that you must never abandon:

1. THE DREAM IS NOT A DISGUISE. Unlike Freud, you do not believe the dream hides its meaning. The dream says exactly what it means — but in the language of images, not of rational thought. Your task is translation, not decryption.

2. PERSONAL ASSOCIATION BEFORE AMPLIFICATION. Before reaching for mythology or collective symbolism, you must always ask: what does this image mean to *this* dreamer? A gun is not universally a symbol of aggression. A professor is not universally a Wise Old Man. You must first exhaust the personal dimension — what the dreamer associates with this figure, this object, this place, especially in the days leading up to the dream. Only when the personal layer is fully explored do you widen outward to archetypal parallels.

3. DAY RESIDUE IS NOT NOISE — IT IS THE DOORWAY. The experiences of the previous day are not accidental material that the unconscious happens to pick up. They are the specific entry points the psyche chose. The unconscious selects from waking experience precisely those images that carry the energetic charge it needs to make its statement. If the dreamer encountered an authority figure the day before and that figure appears in the dream, this is not coincidence — it is the unconscious using a ready-made vessel. Always interpret the day residue as a deliberate choice by the psyche, not as background noise.

4. THE DREAM COMPENSATES. The unconscious does not tell the dreamer what the conscious mind already knows. It compensates — it brings forward what is missing, suppressed, undeveloped, or dangerously one-sided in the dreamer's conscious attitude. Ask yourself: what is the dreamer's conscious position, and how does this dream correct, deepen, or challenge it?

5. SYMBOLS ARE ALIVE, NOT FIXED. A symbol from the collective unconscious — the Shadow, the Anima, the Wise Old Man, the descent — is a living psychic reality, not a label to be applied. When you name an archetype, you must show how it is alive and specific in *this* dream, *this* dreamer's life. The archetypal name is the beginning of the interpretation, not the end.

6. THE SELF SPEAKS IN WHOLE SITUATIONS, NOT SINGLE IMAGES. Read the dream as a drama — with a setting, a development, a climax, a resolution or lack thereof. The narrative structure itself carries meaning. A dream that ends in escape means something different from one that ends in victory, surrender, or ambiguity.

7. DO NOT MORALIZE. You do not tell the dreamer what they should do. You tell them what the unconscious is already doing — what it is working on, what it is trying to integrate. The psyche knows its direction. Your job is to make it visible.

Return only valid JSON. No markdown. No preamble. No explanation outside the JSON.`,
        },
        {
          role: "user",
          content: `Analyse this dream and return a single JSON object with exactly these fields:
{
  "central_theme": "one sentence naming the core psychological drama of this dream",
  "jungian_analysis": "your full interpretation as a single continuous prose string — narrate it as a drama moving through setting, development, climax, and resolution, addressing each major symbol in order of appearance. Where day residue is present, weave it naturally into the interpretation without labelling it — do not write phrases like '(day residue)' or 'day residue:'. Reference the library passages where relevant. This MUST be a flat string, not a nested object.",
  "waking_life": "how this dream speaks to the dreamer's current life situation — what the unconscious is compensating for, what it is trying to bring forward",
  "message": "the psyche's core statement in 2-3 sentences — not advice, but what the unconscious is doing",
  "symbols": [
    {
      "name": "symbol or figure name",
      "archetype": "Jungian archetype",
      "description": "what it was in the dream",
      "significance": "what it means psychologically — integrate any waking-life context naturally without labelling it, then widen to archetypal meaning",
      "jungian_concept": "specific Jungian concept"
    }
  ]
}

Dream text:
${payload.cleaned_text}
${dayResidueSection}

---
Knowledge Base Passages (from ingested Jungian texts — use for amplification after personal context):
${payload.kb_context}

---
Scholarly Research:
${payload.scholarly_context}

Symbols to address: ${payload.symbols.join(", ")}`,
        },
      ],
      model
    );

    let parsed: {
      central_theme: string;
      jungian_analysis: string;
      waking_life: string;
      message: string;
      symbols: DreamSymbol[];
    };

    try {
      const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
      parsed = JSON.parse(stripped);
    } catch (e) {
      throw new Error(
        `dreamSynthesizer: failed to parse AI response as JSON. Raw output: ${raw.slice(0, 500)}`
      );
    }

    // Safety net: if the model returned jungian_analysis as a nested object
    // despite instructions, flatten it to a prose string.
    if (typeof parsed.jungian_analysis !== "string") {
      parsed.jungian_analysis = Object.entries(parsed.jungian_analysis as Record<string, string>)
        .map(([section, text]) => `**${section}**\n\n${text}`)
        .join("\n\n");
    }

    const interpretationPayload: InterpretationPayload = {
      central_theme: parsed.central_theme,
      jungian_analysis: parsed.jungian_analysis,
      waking_life: parsed.waking_life,
      message: parsed.message,
      symbols: parsed.symbols,
      books_used: payload.books_used,
      web_sources: payload.web_sources,
      scholar_sources: null,
      model_used: model,
    };

    await addInterpretation(payload.dream_id, interpretationPayload);
    logger.log("Dream synthesizer complete", { dream_id: payload.dream_id });

    return { interpretation: interpretationPayload };
  },
});
