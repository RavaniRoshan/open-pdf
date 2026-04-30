import { CreateMLCEngine } from "@mlc-ai/web-llm";

window.LocalEngine = {
  engine: null,
  isLoaded: false,
  isDownloading: false,

  async init(progressCallback) {
    if (this.isLoaded) return;
    this.isDownloading = true;

    try {
      this.engine = await CreateMLCEngine("Llama-3.2-1B-Instruct-q4f32_1-MLC", {
        initProgressCallback: (progress) => {
          if (progressCallback) progressCallback(progress);
        }
      });
      this.isLoaded = true;
    } catch (err) {
      console.error("[LocalEngine] Failed to initialize:", err);
      throw err;
    } finally {
      this.isDownloading = false;
    }
  },

  async *stream(systemPrompt, userPrompt) {
    if (!this.engine) throw new Error("Local engine not loaded. Please initialize first.");
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];

    const chunks = await this.engine.chat.completions.create({
      messages,
      stream: true,
      temperature: 0.3,
    });

    for await (const chunk of chunks) {
      yield chunk.choices[0]?.delta?.content || "";
    }
  }
};
