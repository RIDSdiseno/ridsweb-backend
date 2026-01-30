export type AIPart =
  | {
      type: "reasoning";
      reasoning: string;
    }
  | {
      type: "tool-call";
      toolName: string;
      args?: any;
    }
  | {
      type: "text";
      text: string;
    };

export type AIMessage = {
  role: "assistant";
  parts: AIPart[];
};
