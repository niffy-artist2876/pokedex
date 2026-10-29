import "server-only";
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";

// Same model as dataset/seed.py --embed (sentence-transformers all-MiniLM-L6-v2,
// mean pooling, normalized), so query vectors and stored vectors are comparable.
const MODEL = "Xenova/all-MiniLM-L6-v2";

let extractor: Promise<FeatureExtractionPipeline> | null = null;

/** Embeds text and returns it as a pgvector literal, e.g. "[0.01,-0.2,...]". */
export async function embed(text: string): Promise<string> {
  extractor ??= pipeline("feature-extraction", MODEL, { dtype: "fp32" }) as Promise<FeatureExtractionPipeline>;
  const output = await (await extractor)(text, { pooling: "mean", normalize: true });
  return `[${Array.from(output.data as Float32Array).join(",")}]`;
}

/** The text stored for a move or ability, matching seed.py: "Name: description". */
export function descriptionText(name: string, description: string) {
  return `${name}: ${description}`;
}
