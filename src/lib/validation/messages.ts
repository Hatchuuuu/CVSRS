import { z } from "zod";

/** Plain-language defaults for request validation. Messages written on a schema always take precedence. */
z.config({
  customError: (iss) => {
    switch (iss.code) {
      case "invalid_type":
        return iss.input === undefined || iss.input === null ? "This is required." : "This value is not valid.";
      case "too_small":
        if (iss.origin === "string") return Number(iss.minimum) <= 1 ? "This is required." : `Enter at least ${iss.minimum} characters.`;
        if (iss.origin === "array" || iss.origin === "set") return `Choose at least ${iss.minimum}.`;
        return `Enter ${iss.minimum} or more.`;
      case "too_big":
        if (iss.origin === "string") return `Keep this to ${iss.maximum} characters or fewer.`;
        if (iss.origin === "array" || iss.origin === "set") return `Choose at most ${iss.maximum}.`;
        return `Enter ${iss.maximum} or less.`;
      case "invalid_format":
        if (iss.format === "uuid" || iss.format === "guid") return "Choose an option from the list.";
        if (iss.format === "date") return "Enter a valid date.";
        if (iss.format === "datetime") return "Enter a valid date and time.";
        if (iss.format === "email") return "Enter a valid email address.";
        return "This value is not in the expected format.";
      case "invalid_value":
        return "Choose one of the listed options.";
      case "unrecognized_keys":
        return "The request contained fields this form does not use.";
      default:
        return undefined;
    }
  },
});
