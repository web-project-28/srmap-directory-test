const https = require("https");
const cheerio = require("cheerio");

const TARGETS = {
  student: "https://intranet.srmap.edu.in/student-directory/",
  faculty: "https://intranet.srmap.edu.in/faculty-directory/",
  staff: "https://intranet.srmap.edu.in/staff-directory/"
};

const UA =
  "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/153.0.0.0 Mobile Safari/537.36";

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);

    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: "GET",
        headers: {
          "User-Agent": UA,
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": "https://intranet.srmap.edu.in/",
          "Origin": "https://intranet.srmap.edu.in"
        }
      },
      res => {
        let body = "";

        res.setEncoding("utf8");

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {
          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body
          });
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

function clean(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

async function inspect(type) {
  const url = TARGETS[type];

  const response = await fetchPage(url);

  const $ = cheerio.load(response.body);

  const forms = [];

  $("form").each((index, form) => {
    const $form = $(form);

    const inputs = [];

    $form.find("input").each((_, input) => {
      const $input = $(input);

      inputs.push({
        type: $input.attr("type") || "text",
        name: $input.attr("name") || "",
        id: $input.attr("id") || "",
        value: $input.attr("value") || "",
        placeholder: $input.attr("placeholder") || ""
      });
    });

    const selects = [];

    $form.find("select").each((_, select) => {
      const $select = $(select);

      const options = [];

      $select.find("option").each((_, option) => {
        const $option = $(option);

        options.push({
          text: clean($option.text()),
          value: $option.attr("value") || "",
          selected: $option.is(":selected")
        });
      });

      selects.push({
        name: $select.attr("name") || "",
        id: $select.attr("id") || "",
        class: $select.attr("class") || "",
        options
      });
    });

    const buttons = [];

    $form.find("button, input[type='submit']").each((_, button) => {
      const $button = $(button);

      buttons.push({
        tag: button.name,
        type: $button.attr("type") || "",
        name: $button.attr("name") || "",
        value: $button.attr("value") || "",
        text: clean($button.text())
      });
    });

    forms.push({
      index,
      action: $form.attr("action") || "",
      method: ($form.attr("method") || "GET").toUpperCase(),
      id: $form.attr("id") || "",
      class: $form.attr("class") || "",
      inputs,
      selects,
      buttons,
      text: clean($form.text()).slice(0, 3000)
    });
  });

  const scripts = [];

  $("script").each((_, script) => {
    const $script = $(script);

    const src = $script.attr("src");

    if (src) {
      scripts.push({
        type: "external",
        src
      });
    } else {
      const text = $script.html() || "";

      if (
        /ajax|fetch|xmlhttprequest|admin-ajax|directory|search/i.test(
          text
        )
      ) {
        scripts.push({
          type: "inline",
          content: text.slice(0, 8000)
        });
      }
    }
  });

  const relevantHtml = [];

  $("select, input, button, form").each((_, element) => {
    relevantHtml.push($.html(element));
  });

  return {
    requestedUrl: url,
    httpStatus: response.status,
    contentType: response.headers["content-type"] || "",
    pageTitle: clean($("title").text()),

    forms,

    scripts,

    relevantHtml: relevantHtml.slice(0, 200),

    bodyText: clean($("body").text()).slice(0, 10000),

    htmlStart: response.body.slice(0, 30000)
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const action = req.query.action || "";
    const type = req.query.type || "student";

    if (!TARGETS[type]) {
      return res.status(400).json({
        error: "Invalid type. Use student, faculty or staff."
      });
    }

    if (action !== "inspect") {
      return res.status(400).json({
        error:
          "Inspector is active. Use ?action=inspect&type=student"
      });
    }

    const data = await inspect(type);

    return res.status(200).json(data);

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error.message || "Inspection failed",
      stack: error.stack || ""
    });
  }
};
