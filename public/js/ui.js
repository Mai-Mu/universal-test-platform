export const ui = {
  showModal(title, message, type = "alert", defaultVal = "") {
    return new Promise(resolve => {
      const overlay = document.getElementById("custom-modal-overlay");
      if (!overlay) {
        if (type === "alert") return resolve(window.alert(message));
        if (type === "confirm") return resolve(window.confirm(message));
        if (type === "prompt") return resolve(window.prompt(message, defaultVal));
      }

      document.getElementById("custom-modal-title").textContent = title;
      const messageBox = document.getElementById("custom-modal-message");
      messageBox.textContent = message;
      messageBox.style.whiteSpace = "pre-line";

      const inputContainer = document.getElementById("custom-modal-input-container");
      const input = document.getElementById("custom-modal-input");
      const cancelBtn = document.getElementById("custom-modal-cancel");
      const confirmBtn = document.getElementById("custom-modal-confirm");

      overlay.style.display = "flex";

      if (type === "prompt") {
        inputContainer.style.display = "block";
        input.value = defaultVal || "";
        input.focus();
      } else {
        inputContainer.style.display = "none";
      }

      if (type === "alert") {
        cancelBtn.style.display = "none";
        confirmBtn.focus();
      } else {
        cancelBtn.style.display = "block";
        if (type !== "prompt") confirmBtn.focus();
      }

      const newCancel = cancelBtn.cloneNode(true);
      const newConfirm = confirmBtn.cloneNode(true);
      cancelBtn.replaceWith(newCancel);
      confirmBtn.replaceWith(newConfirm);

      const close = val => {
        overlay.style.display = "none";
        resolve(val);
      };

      newCancel.onclick = () => close(type === "prompt" ? null : false);
      newConfirm.onclick = () => {
        if (type === "prompt") close(input.value);
        else close(type === "confirm" ? true : undefined);
      };

      if (type === "prompt") {
        input.onkeydown = event => {
          if (event.key === "Enter") newConfirm.click();
        };
      }
    });
  },

  alert(message) {
    return this.showModal("提示", message, "alert");
  },

  confirm(message) {
    return this.showModal("⚠️ 操作确认", message, "confirm");
  },

  prompt(message, defaultVal = "") {
    return this.showModal("需要您的输入", message, "prompt", defaultVal);
  }
};

window.ui = ui;
