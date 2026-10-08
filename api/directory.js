const https = require("https");


const TARGETS = {

  student:
    "https://intranet.srmap.edu.in/student-directory/",

  faculty:
    "https://intranet.srmap.edu.in/faculty-directory/",

  staff:
    "https://intranet.srmap.edu.in/staff-directory/"

};


function clean(value) {

  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

}


function absoluteURL(base, href) {

  try {

    return new URL(
      href,
      base
    ).toString();

  } catch {

    return "";

  }

}


function request(url, options = {}) {

  return new Promise(
    (resolve, reject) => {

      const parsed =
        new URL(url);


      const requestOptions = {

        protocol:
          parsed.protocol,

        hostname:
          parsed.hostname,

        port:
          parsed.port || 443,

        path:
          parsed.pathname +
          parsed.search,

        method:
          options.method || "GET",

        headers: {

          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/153 Safari/537.36",

          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",

          "Accept-Language":
            "en-US,en;q=0.9",

          "Referer":
            options.referer || url,

          "Origin":
            "https://intranet.srmap.edu.in",

          ...(options.headers || {})

        }

      };


      const req =
        https.request(
          requestOptions,
          response => {

            let body = "";


            response.setEncoding(
              "utf8"
            );


            response.on(
              "data",
              chunk => {

                body += chunk;

              }
            );


            response.on(
              "end",
              () => {

                resolve({

                  status:
                    response.statusCode || 0,

                  headers:
                    response.headers || {},

                  body,

                  url

                });

              }
            );

          }
        );


      req.on(
        "error",
        reject
      );


      req.setTimeout(
        15000,
        () => {

          req.destroy(
            new Error(
              "SRM Intranet request timed out"
            )
          );

        }
      );


      if (options.body) {

        req.write(
          options.body
        );

      }


      req.end();

    }
  );

}


function getCookies(headers) {

  const cookies =
    headers["set-cookie"];


  if (!cookies) {
    return [];
  }


  if (Array.isArray(cookies)) {

    return cookies.map(
      cookie =>
        cookie.split(";")[0]
    );

  }


  return [
    String(cookies)
      .split(";")[0]
  ];

}


function parseAttributes(tag) {

  const attributes = {};

  const regex =
    /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;


  let match;


  while (
    (match = regex.exec(tag))
  ) {

    attributes[
      match[1].toLowerCase()
    ] =
      match[2] ??
      match[3] ??
      match[4] ??
      "";

  }


  return attributes;

}


function findSearchForm(
  html,
  baseURL
) {

  const forms =
    [
      ...html.matchAll(
        /<form\b[^>]*>[\s\S]*?<\/form>/gi
      )
    ];


  let best = null;


  for (
    const formMatch of forms
  ) {

    const raw =
      formMatch[0];


    const opening =
      raw.match(
        /^<form\b[^>]*>/i
      )?.[0] || "";


    const formAttributes =
      parseAttributes(
        opening
      );


    const inputs = [];


    const elements =
      [
        ...raw.matchAll(
          /<(input|select|textarea)\b[^>]*>[\s\S]*?(?:<\/select>|<\/textarea>)?/gi
        )
      ];


    for (
      const element of elements
    ) {

      const tag =
        element[0];


      const type =
        element[1]
          .toLowerCase();


      const attributes =
        parseAttributes(tag);


      inputs.push({

        type,

        attributes,

        text:
          clean(tag)

      });

    }


    const lower =
      raw.toLowerCase();


    let score = 0;


    if (
      lower.includes("search")
    ) {

      score += 3;

    }


    if (
      lower.includes("enter")
    ) {

      score += 2;

    }


    if (
      inputs.some(
        item =>
          /search|keyword|name|student|faculty|staff/i.test(
            (
              item.attributes.name ||
              ""
            ) +
            " " +
            (
              item.attributes.placeholder ||
              ""
            )
          )
      )
    ) {

      score += 4;

    }


    if (
      inputs.some(
        item =>
          item.type === "select"
      )
    ) {

      score += 1;

    }


    if (
      !best ||
      score > best.score
    ) {

      best = {

        score,

        action:
          absoluteURL(
            baseURL,
            formAttributes.action ||
            baseURL
          ),

        method:
          (
            formAttributes.method ||
            "GET"
          ).toUpperCase(),

        raw,

        inputs

      };

    }

  }


  return best;

}


function createFormPayload(
  form,
  query
) {

  const pairs = [];


  for (
    const item of form.inputs
  ) {

    const attributes =
      item.attributes;


    const name =
      attributes.name;


    if (!name) {
      continue;
    }


    if (
      item.type === "input"
    ) {

      const inputType =
        (
          attributes.type ||
          "text"
        ).toLowerCase();


      if (
        [
          "submit",
          "button",
          "reset",
          "file"
        ].includes(inputType)
      ) {

        continue;

      }


      if (
        inputType === "checkbox" ||
        inputType === "radio"
      ) {

        if (
          attributes.checked !==
          undefined
        ) {

          pairs.push([
            name,
            attributes.value ||
            "on"
          ]);

        }

        continue;

      }


      let value =
        attributes.value ||
        "";


      if (
        inputType !== "hidden"
      ) {

        if (
          /search|keyword|query|name|enter|student|faculty|staff/i.test(
            name +
            " " +
            (
              attributes.placeholder ||
              ""
            )
          )
        ) {

          value = query;

        }

      }


      pairs.push([
        name,
        value
      ]);

    }


    else if (
      item.type === "textarea"
    ) {

      pairs.push([
        name,
        query
      ]);

    }


    else if (
      item.type === "select"
    ) {

      const selected =
        item.text.match(
          /<option\b[^>]*selected[^>]*value\s*=\s*(?:"([^"]*)"|'([^']*)')/i
        );


      const value =
        selected
          ? (
              selected[1] ??
              selected[2] ??
              ""
            )
          : "";


      pairs.push([
        name,
        value
      ]);

    }

  }


  /*
    If no field was identified
    as the search field, use
    the first text-like field.
  */

  if (
    !pairs.some(
      pair =>
        pair[1] === query
    )
  ) {

    const candidate =
      form.inputs.find(
        item =>

          item.type === "input" &&

          /^(text|search)?$/i.test(
            item.attributes.type ||
            "text"
          ) &&

          item.attributes.name
      );


    if (candidate) {

      const index =
        pairs.findIndex(
          pair =>
            pair[0] ===
            candidate.attributes.name
        );


      if (index >= 0) {

        pairs[index][1] =
          query;

      } else {

        pairs.push([
          candidate.attributes.name,
          query
        ]);

      }

    }

  }


  return new URLSearchParams(
    pairs
  ).toString();

}


function removeScripts(
  html
) {

  return html

    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ""
    )

    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ""
    );

}


function parseDirectoryResults(
  html,
  baseURL
) {

  const cleanHTML =
    removeScripts(html);


  const results = [];

  const blocks = [];


  const patterns = [

    /<(?:article|div|li)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:directory|faculty|staff|student|profile|member|team|card)[^"']*["'][^>]*>[\s\S]*?<\/(?:article|div|li)>/gi,

    /<tr\b[\s\S]*?<\/tr>/gi

  ];


  for (
    const pattern of patterns
  ) {

    for (
      const match of cleanHTML.matchAll(
        pattern
      )
    ) {

      const block =
        match[0];


      if (
        /@srmap\.edu\.in|read\s*more|department/i.test(
          block
        )
      ) {

        blocks.push(
          block
        );

      }


      if (
        blocks.length >= 300
      ) {

        break;

      }

    }


    if (
      blocks.length
    ) {

      break;

    }

  }


  for (
    const block of blocks
  ) {

    const text =
      clean(block);


    const email =
      (
        text.match(
          /[A-Z0-9._%+-]+@srmap\.edu\.in/i
        ) || []
      )[0] || "";


    if (
      !email &&
      !/read\s*more/i.test(
        text
      )
    ) {

      continue;

    }


    const hrefMatch =
      block.match(
        /<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>/i
      );


    const profileURL =
      hrefMatch
        ? absoluteURL(
            baseURL,
            hrefMatch[1] ||
            hrefMatch[2]
          )
        : "";


    const departmentMatch =
      text.match(
        /department\s*:?\s*(department of [^|]+?)(?=\s+(?:email|designation|phone|read more)\b|$)/i
      );


    const designationMatch =
      text.match(
        /designation\s*:?\s*([^|]+?)(?=\s+(?:department|email|phone|read more)\b|$)/i
      );


    const phoneMatch =
      text.match(
        /(?:phone|mobile|contact)\s*:?\s*([+()\d][+()\d\s-]{6,})/i
      );


    let name = "";


    const nameMatch =
      text.match(
        /(?:name\s*:?\s*)?([A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){1,8})(?=\s+(?:department|email|designation|phone|read more)\b)/i
      );


    if (nameMatch) {

      name =
        nameMatch[1].trim();

    }


    if (
      !name &&
      email
    ) {

      name =
        text
          .split(
            /\s+(?:Department|Email|Designation|Phone|Read More)\b/i
          )[0]
          .trim();

    }


    results.push({

      name:
        clean(name),

      department:
        clean(
          departmentMatch?.[1] ||
          ""
        ),

      email,

      designation:
        clean(
          designationMatch?.[1] ||
          ""
        ),

      phone:
        clean(
          phoneMatch?.[1] ||
          ""
        ),

      profileUrl:
        profileURL

    });

  }


  /*
    Remove duplicates.
  */

  const seen =
    new Set();


  return results.filter(
    person => {

      const key =
        (
          person.name +
          "|" +
          person.email +
          "|" +
          person.profileUrl
        ).toLowerCase();


      if (
        seen.has(key)
      ) {

        return false;

      }


      seen.add(key);

      return true;

    }
  );

}


async function searchDirectory(
  type,
  query
) {

  const target =
    TARGETS[type];


  const first =
    await request(
      target
    );


  let cookies =
    getCookies(
      first.headers
    ).join("; ");


  if (
    first.status >= 400
  ) {

    throw new Error(
      `SRM Intranet returned HTTP ${first.status}`
    );

  }


  const attempts = [];


  /*
    STEP 1:
    Discover the actual search form.
  */

  const form =
    findSearchForm(
      first.body,
      target
    );


  if (form) {

    const payload =
      createFormPayload(
        form,
        query
      );


    attempts.push({

      method:
        form.method,

      action:
        form.action,

      payload:
        payload.slice(
          0,
          500
        )

    });


    const response =
      await request(
        form.action,
        {

          method:
            form.method,

          referer:
            target,

          headers: {

            "Content-Type":
              "application/x-www-form-urlencoded",

            ...(cookies
              ? {
                  Cookie:
                    cookies
                }
              : {})

          },

          body:
            form.method === "POST"
              ? payload
              : undefined

        }
      );


    if (
      response.body
    ) {

      const parsed =
        parseDirectoryResults(
          response.body,
          form.action
        );


      if (
        parsed.length
      ) {

        return {

          results:
            parsed,

          attempts

        };

      }

    }

  }


  /*
    STEP 2:
    Try common GET
    search patterns.
  */

  const fallbackURLs = [

    `${target}?s=${encodeURIComponent(query)}`,

    `${target}?search=${encodeURIComponent(query)}`,

    `${target}?keyword=${encodeURIComponent(query)}`,

    `${target}?q=${encodeURIComponent(query)}`,

    `${target}?name=${encodeURIComponent(query)}`

  ];


  for (
    const url of fallbackURLs
  ) {

    attempts.push({

      method:
        "GET",

      url

    });


    const response =
      await request(
        url,
        {

          method:
            "GET",

          referer:
            target,

          headers:
            cookies
              ? {
                  Cookie:
                    cookies
                }
              : {}

        }
      );


    const parsed =
      parseDirectoryResults(
        response.body,
        url
      );


    if (
      parsed.length
    ) {

      return {

        results:
          parsed,

        attempts

      };

    }

  }


  return {

    results: [],

    attempts,

    sourceHtmlLength:
      first.body.length

  };

}


module.exports =
  async function handler(
    req,
    res
  ) {

    /*
      CORS
    */

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


    if (
      req.method === "OPTIONS"
    ) {

      return res
        .status(204)
        .end();

    }


    if (
      req.method !== "GET"
    ) {

      return res
        .status(405)
        .json({

          error:
            "GET only"

        });

    }


    const type =
      String(
        req.query?.type ||
        "student"
      ).toLowerCase();


    const query =
      String(
        req.query?.q ||
        ""
      ).trim();


    if (
      !TARGETS[type]
    ) {

      return res
        .status(400)
        .json({

          error:
            "Invalid directory type. Use student, faculty, or staff."

        });

    }


    if (
      query.length < 2
    ) {

      return res
        .status(400)
        .json({

          error:
            "Search text must contain at least 2 characters."

        });

    }


    if (
      query.length > 100
    ) {

      return res
        .status(400)
        .json({

          error:
            "Search text is too long."

        });

    }


    try {

      const output =
        await searchDirectory(
          type,
          query
        );


      return res
        .status(200)
        .json({

          ok:
            true,

          directory:
            type,

          query,

          results:
            output.results.slice(
              0,
              50
            ),

          /*
            Debug information is
            returned only when the
            Vercel environment variable
            DIRECTORY_DEBUG=1 is enabled.
          */

          debug:
            process.env.DIRECTORY_DEBUG ===
            "1"
              ? {

                  attempts:
                    output.attempts,

                  sourceHtmlLength:
                    output.sourceHtmlLength

                }
              : undefined

        });

    }

    catch (error) {

      return res
        .status(502)
        .json({

          ok:
            false,

          error:
            error.message ||
            "Directory lookup failed",

          hint:
            "The backend could not complete the live SRM Intranet directory request."

        });

    }

  };
