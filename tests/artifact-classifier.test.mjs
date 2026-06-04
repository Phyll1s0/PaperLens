import assert from "node:assert/strict";
import {
  isLikelyCaptionBlockText,
  isLikelyCodeBlockText,
  isLikelyFormulaBlockText,
  isLikelyTableBodyBlockText,
  isUsefulFormulaArtifactText,
} from "../lib/artifact-classifier.js";

assert.equal(isLikelyCaptionBlockText("Figure 2. FP4 quantization: A comparison of FP16 and E8M0 scaling factors."), true);
assert.equal(isLikelyCaptionBlockText("Table 1. The features of DNN accelerators across different scaling factors."), true);
assert.equal(isLikelyCaptionBlockText("Figure 1. Overview of the proposed visual encoder and text decoder."), true);
assert.equal(isLikelyCaptionBlockText("Fig. 1: End-to-end workflow for PaperLens visual reconstruction."), true);
assert.equal(isLikelyCaptionBlockText("Table 1: Quantitative comparison across baselines and ablations."), true);
assert.equal(isLikelyCaptionBlockText("Figure 2 shows the quantization process in detail."), false);

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
    "Return Forecasting 0.0675 (RankIC) Return Forecasting Volatility Forecasting 0.0702 (IC) (MAE) 0.037 Price Forecasting 0.0267 (RankIC)",
    { lineCount: 4 },
  ),
  false,
);

assert.equal(
  isLikelyCodeBlockText(
    "Let D-dimensional vector xt ∈RD denote the K-line observation at discrete time t, comprising D key financial indicators. In this work, we fix the dimension D= 6 to represent OHLCVA attributes.",
    { lineCount: 6 },
  ),
  false,
);

assert.equal(
  isLikelyCodeBlockText(
    "0331 13:25 0402 10:35 0403 14:45 0408 13:25 0410 10:35 0411 14:45 Time GroundTruth Kline Chart",
    { lineCount: 3 },
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
    "Algorithm 1 Visual region rebuild Input: page blocks B and rendered page image I Output: crops C 1: C←∅ 2: for b∈B do 3: if caption(b) then 4: C←C∪refine(b,I) 5: end if 6: return C",
    { lineCount: 8 },
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

assert.equal(
  isLikelyCodeBlockText(
    "Pseudo-code is only used to summarize the high-level pipeline. The actual implementation follows the repository configuration and runs as a persistent local service.",
    { lineCount: 3 },
  ),
  false,
);

assert.equal(
  isLikelyFormulaBlockText("H+1 |Vts | ℓ(θ) =−", { lineCount: 3 }),
  true,
);

assert.equal(
  isLikelyFormulaBlockText("MASE( ˆ xi,xi) = C−S", { lineCount: 2 }),
  true,
);

assert.equal(
  isLikelyFormulaBlockText("h = 1 h = 1 2150 2200 2250 2300 2350 Token ID", { lineCount: 5 }),
  false,
);

assert.equal(
  isLikelyFormulaBlockText("h = 1", { lineCount: 1 }),
  false,
);

assert.equal(
  isLikelyFormulaBlockText("GPT4TS Task-specific Reference No Fine-tuning epochs: 100, cos: 1, tmax: 10, nL = 6,η = 10−3", { lineCount: 1 }),
  false,
);

assert.equal(
  isLikelyFormulaBlockText("QLα(q,x) = α(x−q), if x>q, To aggregate Eq. (4) over multiple series and prediction instants, we consider the weighted average", { lineCount: 2 }),
  false,
);

assert.equal(
  isLikelyFormulaBlockText("Accuracy 91.2 92.4 93.1 Latency 18.7 15.3 12.9 Params 7B 13B 34B", { lineCount: 4 }),
  false,
);

assert.equal(
  isLikelyFormulaBlockText("xt = Codebook(OHLCVA), bt = [bc t,bf t], p(bt|b<t)=p(bc t|b<t)p(bf t|b<t,bc t)", { lineCount: 3 }),
  true,
);

assert.equal(isUsefulFormulaArtifactText("Xt = i=1"), false);
assert.equal(isUsefulFormulaArtifactText("C+H t=C+1 |ˆ"), false);
assert.equal(isUsefulFormulaArtifactText("WQL = 1 WQLαj. j=1"), true);
assert.equal(isUsefulFormulaArtifactText("MASE( ˆ xi,xi) = C−S"), true);

assert.equal(
  isLikelyTableBodyBlockText(
    "Architecture Scaling Factor Data Type Metadata OliVe [27] Tensor/Channel FP16 Tensor/Channel INT4, Flint4 Pair Outlier-victim pair",
    { lineCount: 12 },
  ),
  true,
);

assert.equal(
  isLikelyTableBodyBlockText("Granularity Format Granularity Format", { lineCount: 2 }),
  true,
);

assert.equal(
  isLikelyTableBodyBlockText(
    "Model Dataset MAE RMSE MASE Chronos ETTh1 0.412 0.438 0.782 Kronos ETTh1 0.376 0.401 0.713",
    { lineCount: 5 },
  ),
  true,
);

assert.equal(
  isLikelyTableBodyBlockText(
    "For fairness, all accelerators are configured with 32×32 PEs supporting 4-bit multiplications, ensuring differences arise from architectural and algorithmic design.",
    { lineCount: 4 },
  ),
  false,
);
