import assert from "node:assert/strict";
import { isLikelyCodeBlockText } from "../lib/artifact-classifier.js";

assert.equal(
  isLikelyCodeBlockText(
    "Xue & Salim, 2023) and fine-tuning LLMs for time series tasks. However, these methods face significant limitations, notably the need for prompt engineering or fine-tuning for each new task.",
    { lineCount: 7 },
  ),
  false,
);

assert.equal(
  isLikelyCodeBlockText(
    "Whenever possible, we evaluated models both in terms of their probabilistic and point forecast performance. We used the weighted quantile loss to assess probabilistic forecasts.",
    { lineCount: 6 },
  ),
  false,
);

assert.equal(
  isLikelyCodeBlockText(
    "128,lmax = 2048). Output: An augmented time series. 1: k∼U{1,K} 2: l∼U{lmin,lmax} 3: for i←1,k do 4: n∼U{1,Nd} 5: x(i) 1:l ∼Xn 6: end for 7: return x",
    { lineCount: 12 },
  ),
  true,
);

assert.equal(
  isLikelyCodeBlockText(
    "function tokenize(values) {\n  const ids = values.map(scale);\n  return ids;\n}",
    { lineCount: 4 },
  ),
  true,
);
