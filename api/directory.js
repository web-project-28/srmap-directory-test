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

function fetchPage(url, options = {}) {

  return new Promise((resolve, reject) => {

    const parsed = new URL(url);

    const req = https.request(
      {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        method: options.method || "GET",

        headers: {
          "User-Agent": UA,
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Referer": options.referer || url,
          "Origin": "https://intranet.srmap.edu.in",
          ...(options.headers || {})
        }
      },

      res => {

        let body = "";

        res.setEncoding("utf8");

        res.on("data", chunk => {
          body += chunk;
        });

        res.on("end", () => {

          const cookies =
            (res.headers["set-cookie"] || [])
              .map(x => x.split(";")[0])
              .join("; ");

          resolve({
            status: res.statusCode || 0,
            headers: res.headers,
            body,
            cookies,
            finalUrl: url
          });
        });
      }
    );

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

function absoluteUrl(base, value) {

  if (!value) return "";

  try {
    return new URL(value, base).href;
  } catch {
    return "";
  }
}

function normalize(text) {

  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getFormInfo($, baseUrl) {

  let selectedForm = null;

  $("form").each((_, form) => {

    const $form = $(form);

    const text = normalize($form.text()).toLowerCase();

    const hasSelect =
      $form.find("select").length > 0;

    const hasText =
      $form.find(
        'input[type="text"], input:not([type]), textarea'
      ).length > 0;

    const looksRelevant =
      text.includes("department") ||
      text.includes("search") ||
      text.includes("student directory") ||
      text.includes("faculty directory") ||
      text.includes("staff directory");

    if (hasSelect && hasText && looksRelevant && !selectedForm) {
      selectedForm = form;
    }
  });

  if (!selectedForm) {

    $("form").each((_, form) => {

      const $form = $(form);

      if (
        $form.find("select").length &&
        $form.find(
          'input[type="text"], input:not([type]), textarea'
        ).length
      ) {
        selectedForm = form;
      }
    });
  }

  if (!selectedForm) {
    return null;
  }

  const $form = $(selectedForm);

  const action =
    absoluteUrl(
      baseUrl,
      $form.attr("action") || baseUrl
    );

  const method =
    String($form.attr("method") || "GET").toUpperCase();

  return {
    form: selectedForm,
    action,
    method
  };
}

function findDepartmentSelect($, form) {

  const $form = $(form);

  let found = null;

  $form.find("select").each((_, select) => {

    const $select = $(select);

    const text =
      normalize(
        $select.parent().text() +
        " " +
        $select.prev("label").text()
      ).toLowerCase();

    const optionText =
      normalize($select.text()).toLowerCase();

    if (
      text.includes("department") ||
      optionText.includes("department of") ||
      optionText.includes("directorate of")
    ) {
      found = select;
    }
  });

  if (!found) {
    found = $form.find("select").first()[0];
  }

  return found || null;
}

function getDepartments($, form) {

  const select = findDepartmentSelect($, form);

  if (!select) return [];

  const result = [];

  $(select).find("option").each((_, option) => {

    const label = normalize($(option).text());
    const value = $(option).attr("value");

    if (!label) return;

    if (
      !value &&
      /select department/i.test(label)
    ) {
      return;
    }

    result.push({
      label,
      value: value !== undefined ? value : label
    });
  });

  return result;
}

function findSearchInput($, form) {

  const $form = $(form);

  let found = null;

  $form.find(
    'input[type="text"], input:not([type]), textarea'
  ).each((_, input) => {

    if (found) return;

    const $input = $(input);

    const combined = (
      ($input.attr("name") || "") +
      " " +
      ($input.attr("id") || "") +
      " " +
      ($input.attr("placeholder") || "")
    ).toLowerCase();

    if (
      combined.includes("search") ||
      combined.includes("name") ||
      combined.includes("keyword") ||
      combined.includes("enter")
    ) {
      found = input;
    }
  });

  if (!found) {
    found = $form.find(
      'input[type="text"], input:not([type]), textarea'
    ).first()[0];
  }

  return found || null;
}

function collectFormFields($, form) {

  const fields = {};

  $(form).find("input, textarea, select").each((_, el) => {

    const $el = $(el);

    const name = $el.attr("name");

    if (!name) return;

    const type =
      String($el.attr("type") || "").toLowerCase();

    if (
      ["submit", "button", "reset", "file"].includes(type)
    ) {
      return;
    }

    if (
      ["checkbox", "radio"].includes(type) &&
      !$el.is(":checked")
    ) {
      return;
    }

    if ($el.is("select")) {

      const option = $el.find("option:selected");

      fields[name] =
        option.attr("value") !== undefined
          ? option.attr("value")
          : normalize(option.text());

    } else {

      fields[name] = $el.attr("value") || "";
    }
  });

  return fields;
}

function chooseDepartmentValue($, form, requested) {

  const select = findDepartmentSelect($, form);

  if (!select) return requested;

  let exact = null;
  let partial = null;

  $(select).find("option").each((_, option) => {

    const label = normalize($(option).text());
    const value =
      $(option).attr("value") || label;

    if (
      label.toLowerCase() ===
      requested.toLowerCase()
    ) {
      exact = value;
    }

    if (
      !partial &&
      (
        label.toLowerCase().includes(
          requested.toLowerCase()
        ) ||
        requested.toLowerCase().includes(
          label.toLowerCase()
        )
      )
    ) {
      partial = value;
    }
  });

  return exact || partial || requested;
}

function chooseSearchFieldName($, form) {

  const input = findSearchInput($, form);

  if (!input) return null;

  return $(input).attr("name") || null;
}

function encodeForm(fields) {

  return new URLSearchParams(fields).toString();
}

function submitForm(formInfo, fields, cookies) {

  if (formInfo.method === "POST") {

    return fetchPage(formInfo.action, {
      method: "POST",
      referer: TARGETS._referer,
      headers: {
        "Content-Type":
          "application/x-www-form-urlencoded",
        "Cookie": cookies || "",
        "Content-Length":
          Buffer.byteLength(encodeForm(fields))
      },
      body: encodeForm(fields)
    });
  }

  const query = encodeForm(fields);

  const separator =
    formInfo.action.includes("?") ? "&" : "?";

  return fetchPage(
    formInfo.action + separator + query,
    {
      method: "GET",
      referer: TARGETS._referer,
      headers: {
        "Cookie": cookies || ""
      }
    }
  );
}

function findResultContainers($) {

  const containers = [];

  $("body *").each((_, el) => {

    const $el = $(el);

    const text = normalize($el.text());

    if (!/@srmap\.edu\.in/i.test(text)) {
      return;
    }

    const hasName =
      /Name\s*:/i.test(text);

    const hasDepartment =
      /Department\s*:/i.test(text);

    const hasEmail =
      /Email\s*:/i.test(text);

    if (
      hasName &&
      (hasDepartment || hasEmail)
    ) {
      containers.push(el);
    }
  });

  return containers;
}

function parseResults(html, pageUrl) {

  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  const candidates = findResultContainers($);

  for (const element of candidates) {

    let node = element;

    for (let i = 0; i < 6 && node; i++) {

      const $node = $(node);

      const text = normalize($node.text());

      if (
        /Name\s*:/i.test(text) &&
        /Email\s*:/i.test(text)
      ) {

        const emailMatch =
          text.match(
            /Email\s*:\s*([A-Z0-9._%+-]+@srmap\.edu\.in)/i
          );

        const email =
          emailMatch ? emailMatch[1] : "";

        const nameMatch =
          text.match(
            /Name\s*:\s*([\s\S]*?)(?=\s*Department\s*:)/i
          );

        const departmentMatch =
          text.match(
            /Department\s*:\s*([\s\S]*?)(?=\s*Email\s*:)/i
          );

        const name =
          normalize(
            nameMatch ? nameMatch[1] : ""
          );

        const department =
          normalize(
            departmentMatch
              ? departmentMatch[1]
              : ""
          );

        if (!name || !email) {
          node = node.parent;
          continue;
        }

        if (seen.has(email + "|" + name)) {
          break;
        }

        seen.add(email + "|" + name);

        let photo = "";

        const img =
          $node.find("img").first();

        if (img.length) {
          photo =
            absoluteUrl(
              pageUrl,
              img.attr("src") ||
              img.attr("data-src") ||
              ""
            );
        }

        let profileUrl = "";

        $node.find("a").each((_, a) => {

          const href = $(a).attr("href");
          const label = normalize($(a).text());

          if (
            !profileUrl &&
            href &&
            /read more/i.test(label)
          ) {
            profileUrl =
              absoluteUrl(pageUrl, href);
          }
        });

        let phone = "";

        const phoneMatch =
          text.match(
            /(?:Phone|Mobile|Contact)\s*:\s*([+0-9 ()-]{7,})/i
          );

        if (phoneMatch) {
          phone = normalize(phoneMatch[1]);
        }

        results.push({
          name,
          department,
          branch: "",
          designation: "",
          email,
          phone,
          photo,
          profileUrl
        });

        break;
      }

      node = node.parent;
    }
  }

  return results;
}

async function handleDepartments(type) {

  const target = TARGETS[type];

  const page = await fetchPage(target);

  if (page.status >= 400) {
    throw new Error(
      `SRM directory returned HTTP ${page.status}`
    );
  }

  const $ = cheerio.load(page.body);

  const formInfo =
    getFormInfo($, target);

  if (!formInfo) {
    throw new Error(
      "Could not locate the SRM directory filter form."
    );
  }

  const departments =
    getDepartments($, formInfo.form);

  if (!departments.length) {
    throw new Error(
      "Could not read department options from SRM."
    );
  }

  return {
    departments
  };
}

async function handleSearch(type, department, q) {

  const target = TARGETS[type];

  const page = await fetchPage(target);

  if (page.status >= 400) {
    throw new Error(
      `SRM directory returned HTTP ${page.status}`
    );
  }

  const $ = cheerio.load(page.body);

  const formInfo =
    getFormInfo($, target);

  if (!formInfo) {
    throw new Error(
      "Could not locate SRM directory search form."
    );
  }

  const fields =
    collectFormFields($, formInfo.form);

  const deptValue =
    chooseDepartmentValue(
      $,
      formInfo.form,
      department
    );

  const searchField =
    chooseSearchFieldName(
      $,
      formInfo.form
    );

  if (!searchField) {
    throw new Error(
      "Could not identify the SRM name/search field."
    );
  }

  fields[searchField] = q;

  const departmentSelect =
    findDepartmentSelect($, formInfo.form);

  if (departmentSelect) {

    const deptName =
      $(departmentSelect).attr("name");

    if (deptName) {
      fields[deptName] = deptValue;
    }
  }

  TARGETS._referer = target;

  const resultPage =
    await submitForm(
      formInfo,
      fields,
      page.cookies
    );

  if (resultPage.status >= 400) {
    throw new Error(
      `SRM search returned HTTP ${resultPage.status}`
    );
  }

  const results =
    parseResults(
      resultPage.body,
      resultPage.finalUrl
    );

  return {
    results
  };
}

module.exports = async function handler(req, res) {

  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  res.setHeader(
    "Cache-Control",
    "no-store"
  );

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {

    const {
      action = "search",
      type,
      department,
      q
    } = req.query;

    if (!TARGETS[type]) {
      return res.status(400).json({
        error:
          "Invalid directory type. Use student, faculty or staff."
      });
    }

    if (action === "departments") {

      const data =
        await handleDepartments(type);

      return res.status(200).json({
        type,
        ...data
      });
    }

    if (action === "search") {

      if (!department) {
        return res.status(400).json({
          error: "Department is required."
        });
      }

      if (!q || !String(q).trim()) {
        return res.status(400).json({
          error: "Search name is required."
        });
      }

      const data =
        await handleSearch(
          type,
          department,
          String(q).trim()
        );

      return res.status(200).json({
        type,
        department,
        query: String(q).trim(),
        count: data.results.length,
        results: data.results
      });
    }

    return res.status(400).json({
      error: "Unknown action."
    });

  } catch (error) {

    console.error(error);

    return res.status(500).json({
      error:
        error?.message ||
        "Directory backend failed."
    });
  }
};
