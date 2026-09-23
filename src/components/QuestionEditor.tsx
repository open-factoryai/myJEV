import type { QuestionDraft, QuestionType } from "../lib/types";
import { newQuestionId } from "../lib/types";

interface Props {
  question: QuestionDraft;
  index: number;
  total: number;
  onChange: (q: QuestionDraft) => void;
  onRemove: () => void;
  onDuplicate?: () => void;
  onMove?: (dir: -1 | 1) => void;
}

export function QuestionEditor({ question, index, total, onChange, onRemove, onDuplicate, onMove }: Props) {
  const update = (patch: Partial<QuestionDraft>) => onChange({ ...question, ...patch });
  const typeLabel = question.type === "boolean" ? "noul" : question.type;

  const setType = (type: QuestionType) => {
    if (type === "choice" && question.options.length === 0) {
      update({ type, options: [{ key: "yes", description: "" }, { key: "no", description: "" }] });
      return;
    }
    if (type === "score" && question.levels.length === 0) {
      update({ type, levels: ["Low", "Medium", "High"] });
      return;
    }
    update({ type });
  };

  return (
    <div className="question-card" data-type={typeLabel}>
      <div className="question-card-header">
        <span className={`question-type-badge ${typeLabel}`}>{typeLabel}</span>
        <input
          className="question-name-input"
          value={question.name}
          onChange={(e) => update({ name: e.target.value.replace(/\s+/g, "_") })}
          placeholder="question_name"
          spellCheck={false}
          aria-label="Question name"
        />
        <select
          className="question-type-select"
          value={question.type === "boolean" ? "noul" : question.type}
          onChange={(e) => setType(e.target.value as QuestionType)}
          aria-label="Question type"
        >
          <option value="choice">choice</option>
          <option value="score">score</option>
          <option value="noul">noul</option>
        </select>
        <div className="question-tools">
          <button
            type="button"
            className="icon-btn"
            onClick={() => onMove?.(-1)}
            disabled={index === 0}
            title="Move up"
            aria-label="Move up"
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={() => onMove?.(1)}
            disabled={index === total - 1}
            title="Move down"
            aria-label="Move down"
          >
            ↓
          </button>
          {onDuplicate && (
            <button type="button" className="icon-btn" onClick={onDuplicate} title="Duplicate" aria-label="Duplicate">
              ⧉
            </button>
          )}
          <button type="button" className="icon-btn danger" onClick={onRemove} title="Remove" aria-label="Remove">
            ✕
          </button>
        </div>
      </div>

      <div className="question-card-body">
        <input
          className="question-instructions"
          value={question.instructions}
          onChange={(e) => update({ instructions: e.target.value })}
          placeholder={
            question.type === "noul"
              ? "Statement to score, e.g. “Is the customer expressing strong frustration?”"
              : "Instructions for the model…"
          }
        />

        {question.type === "choice" && (
          <div className="options-list">
            <div className="options-head">
              <span>option key</span>
              <span>description / criteria</span>
              <span />
            </div>
            {question.options.map((opt, i) => (
              <div className="option-row" key={i}>
                <input
                  value={opt.key}
                  onChange={(e) => {
                    const options = [...question.options];
                    options[i] = { ...opt, key: e.target.value.replace(/\s+/g, "_") };
                    update({ options });
                  }}
                  placeholder="key"
                  spellCheck={false}
                />
                <input
                  value={opt.description}
                  onChange={(e) => {
                    const options = [...question.options];
                    options[i] = { ...opt, description: e.target.value };
                    update({ options });
                  }}
                  placeholder="what this option means"
                />
                <button
                  type="button"
                  className="option-remove"
                  onClick={() => update({ options: question.options.filter((_, j) => j !== i) })}
                  aria-label="Remove option"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="add-option-btn"
              onClick={() => update({ options: [...question.options, { key: "", description: "" }] })}
            >
              + Add option
            </button>
          </div>
        )}

        {question.type === "score" && (
          <div className="options-list">
            <div className="options-head">
              <span>level</span>
              <span>label</span>
              <span />
            </div>
            {question.levels.map((lvl, i) => (
              <div className="option-row" key={i}>
                <input value={String(i)} disabled style={{ opacity: 0.55, width: 52 }} aria-label={`Level ${i}`} />
                <input
                  value={lvl}
                  onChange={(e) => {
                    const levels = [...question.levels];
                    levels[i] = e.target.value;
                    update({ levels });
                  }}
                  placeholder={`Level ${i} label`}
                />
                <button
                  type="button"
                  className="option-remove"
                  onClick={() => update({ levels: question.levels.filter((_, j) => j !== i) })}
                  aria-label="Remove level"
                >
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="add-option-btn" onClick={() => update({ levels: [...question.levels, ""] })}>
              + Add level
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export function newQuestion(type: QuestionType, name?: string): QuestionDraft {
  const id = newQuestionId();
  if (type === "choice") {
    return {
      id,
      name: name ?? "choice_q",
      type: "choice",
      instructions: "",
      options: [
        { key: "a", description: "" },
        { key: "b", description: "" },
      ],
      levels: [],
    };
  }
  if (type === "score") {
    return {
      id,
      name: name ?? "score_q",
      type: "score",
      instructions: "",
      options: [],
      levels: ["Low", "Medium", "High"],
    };
  }
  return { id, name: name ?? "noul_q", type: "noul", instructions: "", options: [], levels: [] };
}
