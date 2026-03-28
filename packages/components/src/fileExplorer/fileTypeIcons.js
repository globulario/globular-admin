// fileTypeIcons.js — Maps file extensions to vivid SVG icon URLs from file-icon-vectors.
// Individual imports so Vite resolves each asset URL at build time.

import pdf from "file-icon-vectors/dist/icons/vivid/pdf.svg?url";
import zip from "file-icon-vectors/dist/icons/vivid/zip.svg?url";
import rar from "file-icon-vectors/dist/icons/vivid/rar.svg?url";
import sz from "file-icon-vectors/dist/icons/vivid/7z.svg?url";
import gz from "file-icon-vectors/dist/icons/vivid/gz.svg?url";
import tar from "file-icon-vectors/dist/icons/vivid/tar.svg?url";
import doc from "file-icon-vectors/dist/icons/vivid/doc.svg?url";
import docx from "file-icon-vectors/dist/icons/vivid/docx.svg?url";
import xls from "file-icon-vectors/dist/icons/vivid/xls.svg?url";
import xlsx from "file-icon-vectors/dist/icons/vivid/xlsx.svg?url";
import ppt from "file-icon-vectors/dist/icons/vivid/ppt.svg?url";
import pptx from "file-icon-vectors/dist/icons/vivid/pptx.svg?url";
import txt from "file-icon-vectors/dist/icons/vivid/txt.svg?url";
import csv from "file-icon-vectors/dist/icons/vivid/csv.svg?url";
import json from "file-icon-vectors/dist/icons/vivid/json.svg?url";
import xml from "file-icon-vectors/dist/icons/vivid/xml.svg?url";
import html from "file-icon-vectors/dist/icons/vivid/html.svg?url";
import css from "file-icon-vectors/dist/icons/vivid/css.svg?url";
import js from "file-icon-vectors/dist/icons/vivid/js.svg?url";
import ts from "file-icon-vectors/dist/icons/vivid/ts.svg?url";
import py from "file-icon-vectors/dist/icons/vivid/py.svg?url";
import go from "file-icon-vectors/dist/icons/vivid/go.svg?url";
import java from "file-icon-vectors/dist/icons/vivid/java.svg?url";
import mp3 from "file-icon-vectors/dist/icons/vivid/mp3.svg?url";
import mp4 from "file-icon-vectors/dist/icons/vivid/mp4.svg?url";
import mkv from "file-icon-vectors/dist/icons/vivid/mkv.svg?url";
import avi from "file-icon-vectors/dist/icons/vivid/avi.svg?url";
import mov from "file-icon-vectors/dist/icons/vivid/mov.svg?url";
import flac from "file-icon-vectors/dist/icons/vivid/flac.svg?url";
import wav from "file-icon-vectors/dist/icons/vivid/wav.svg?url";
import ogg from "file-icon-vectors/dist/icons/vivid/ogg.svg?url";
import jpg from "file-icon-vectors/dist/icons/vivid/jpg.svg?url";
import png from "file-icon-vectors/dist/icons/vivid/png.svg?url";
import gif from "file-icon-vectors/dist/icons/vivid/gif.svg?url";
import svg from "file-icon-vectors/dist/icons/vivid/svg.svg?url";
import webp from "file-icon-vectors/dist/icons/vivid/webp.svg?url";
import ico from "file-icon-vectors/dist/icons/vivid/ico.svg?url";
import iso from "file-icon-vectors/dist/icons/vivid/iso.svg?url";
import apk from "file-icon-vectors/dist/icons/vivid/apk.svg?url";
import exe from "file-icon-vectors/dist/icons/vivid/exe.svg?url";
import dmg from "file-icon-vectors/dist/icons/vivid/dmg.svg?url";
import deb from "file-icon-vectors/dist/icons/vivid/deb.svg?url";
import rpm from "file-icon-vectors/dist/icons/vivid/rpm.svg?url";
import sh from "file-icon-vectors/dist/icons/vivid/sh.svg?url";
import sql from "file-icon-vectors/dist/icons/vivid/sql.svg?url";
import md from "file-icon-vectors/dist/icons/vivid/md.svg?url";
import yaml from "file-icon-vectors/dist/icons/vivid/yaml.svg?url";
import log from "file-icon-vectors/dist/icons/vivid/log.svg?url";
import conf from "file-icon-vectors/dist/icons/vivid/conf.svg?url";
import epub from "file-icon-vectors/dist/icons/vivid/epub.svg?url";
import m3u from "file-icon-vectors/dist/icons/vivid/m3u.svg?url";
import webm from "file-icon-vectors/dist/icons/vivid/webm.svg?url";
import aac from "file-icon-vectors/dist/icons/vivid/aac.svg?url";
import bmp from "file-icon-vectors/dist/icons/vivid/bmp.svg?url";
import tiff from "file-icon-vectors/dist/icons/vivid/tiff.svg?url";

const icons = {
  pdf, zip, rar, "7z": sz, gz, tar,
  doc, docx, xls, xlsx, ppt, pptx,
  txt, csv, json, xml, html, css, js, ts, py, go, java,
  mp3, mp4, mkv, avi, mov, flac, wav, ogg, aac, webm, m3u,
  jpg, jpeg: jpg, png, gif, svg, webp, ico, bmp, tiff, tif: tiff,
  iso, apk, exe, dmg, deb, rpm,
  sh, sql, md, yaml, yml: yaml, log, conf, epub,
};

/**
 * Get the vivid file-type icon URL for a given file extension.
 * @param {string} ext — lowercase extension without dot (e.g. "pdf", "zip")
 * @returns {string|null} resolved URL or null if no icon exists
 */
export function fileTypeIconUrl(ext) {
  if (!ext) return null;
  return icons[ext.toLowerCase()] || null;
}

/**
 * Get the vivid file-type icon URL from a filename.
 * @param {string} filename
 * @returns {string|null}
 */
export function fileTypeIconForName(filename) {
  if (!filename) return null;
  const i = filename.lastIndexOf(".");
  if (i < 0) return null;
  return fileTypeIconUrl(filename.substring(i + 1));
}
