class IMEOptions {
    static rime_url: string = "http://127.0.0.1:12346";
  
    setSchema = async (body: string = "") => {
      const res = await fetch(IMEOptions.rime_url + "/schema/current", { method: "PUT", body });
      const text = await res.text();
  
      return {
        success: text === body,
        msg: text
      };
    }
  
    getSchema = async () => {
      const res = await fetch(IMEOptions.rime_url + "/schema/current", { method: "GET" });
      const text = await res.text();
  
      return text;
    }
  
    private postAndUpdateFuzzy = async (body: string = "", method: string = "GET") => {
      const res = await fetch(IMEOptions.rime_url + "/algebra", { method, body });
      let text = await res.text();
      console.log("fuzzy text", text)
      return text.split("\n");
    }
  
    getFuzzy = async () => {
      return await this.postAndUpdateFuzzy();
    }
  
    addFuzzy = async (option: string) => {
      return await this.postAndUpdateFuzzy(option, "POST");
    }
  
    removeFuzzy = async (option: string) => {
      return await this.postAndUpdateFuzzy(option, "DELETE");
    }
  }
  
  export default new IMEOptions();
  