import React from "react";
import theme from "./theme"
import { ThemeProvider } from '@mui/material/styles';

import { FormControl, FormControlLabel, Radio, RadioGroup, Checkbox, FormGroup, TextField, Snackbar } from "@mui/material";
import * as styles from "./styles.module.less";
import "./global.css";
import Animation from "./utils/animation";

const schemaMap = [
    {
        value: "luna_pinyin_simp",
        label: "简体拼音"
    },
    {
        value: "double_pinyin_flypy",
        label: "小鹤双拼"
    },
    {
        value: "double_pinyin_mspy",
        label: "微软双拼"
    },
    {
        value: "luna_pinyin",
        label: "朙月拼音"
    },
    {
        value: "double_pinyin",
        label: "自然碼雙拼"
    },
    {
        value: "cangjie5",
        label: "倉頡五代"
    },
    {
        value: "cangjie3",
        label: "倉頡三代"
    },
];

const fuzzyMap = [
    {
        value: "derive/^([zcs])h/$1/",
        label: "zh, ch, sh => z, c, s"
    },
    {
        value: "derive/^([zcs])([^h])/$1h$2/",
        label: "z, c, s => zh, ch, sh"
    },
    {
        value: "derive/^n/l/",
        label: "n => l"
    },
    {
        value: "derive/^l/n/",
        label: "l => n"
    },
    {
        value: "derive/([ei])n$/$1ng/",
        label: "en => eng, in => ing"
    },
    {
        value: "derive/([ei])ng$/$1n/",
        label: "eng => en, ing => in"
    }
];

interface IHomeProps {
}

interface IHomeState {
    currentSchema: string;
    currentFuzzy: Array<string>;
    snackbarOpen: boolean;
    snackbarText: string;
    pageSize: string;
}

class Home extends React.Component<IHomeProps, IHomeState>  {
    constructor(props: IHomeProps) {
        super(props);
        this.state = {
            currentSchema: "",
            currentFuzzy: [],
            snackbarOpen: false,
            snackbarText: "",
            pageSize: "",
        };
    }

    componentDidMount = async () => {
    }

    actionChangeSchema = async (schema: string) => {
    }

    actionChangeFuzzy = async (type: boolean, fuzzy: string) => {
    }

    actionChangePageSize = (pageSize: string) => {
        this.setState({
            pageSize
        });
        localStorage.setItem("pageSize", pageSize)
    }

    public render() {
        const { currentSchema, currentFuzzy, snackbarOpen, snackbarText, pageSize } = this.state;


    return <ThemeProvider theme={theme}>
        <div className={styles.content}>
      <div className={styles.bgBlock}>
        <div className={styles.leftTop1} />
        <div className={styles.leftTop2} />
        <div className={styles.leftTop3} />
        <div className={styles.rightMid1} />
        <div className={styles.rightMid2} />
      </div>
      <div className={styles.topAnimation}>
        <Animation
          loop={true}
          width={500}
          height={180}
        />
      </div>
      <div className={styles.formGroup}>
        <div className={styles.formBox}>
          <FormControl className={styles.formControl}>
            <div className={styles.formLabel}>选择输入法引擎</div>
            <FormGroup>
              <RadioGroup
                value={currentSchema}
                onChange={async (e) => await this.actionChangeSchema(e.target.value)}
                name="schema"
                row
              >
                {
                  schemaMap.map((schema) =>
                    <FormControlLabel
                      control={<Radio />}
                      value={schema.value}
                      label={schema.label}
                    />
                  )
                }
              </RadioGroup>
            </FormGroup>
          </FormControl>
        </div>
        <div className={styles.formBox}>
          <FormControl className={styles.formControl}>
            <div className={styles.pageSize}>
              <div className={styles.formLabel}>设置单页候选词数量</div>
              <TextField
                className={styles.input}
                id="outlined-basic"
                variant="outlined"
                value={pageSize}
                onChange={e => {
                  if (e.target.value.match(/^\+?[1-9]\d*$/) || e.target.value === "") {
                    this.actionChangePageSize(e.target.value);
                  } else {
                    this.setState({
                      snackbarOpen: true,
                      snackbarText: "请输入介于 3-10 之间的数字",
                    });
                  }
                }}
                onBlur={e => {
                  if (!e.target.value.match(/^([3|4|5|6|7|8|9]|(10))$/)) {
                    this.actionChangePageSize("10");
                    this.setState({
                      snackbarOpen: true,
                      snackbarText: "请输入介于 3-10 之间的数字",
                    });
                  }
                }}
              />
            </div>
          </FormControl>
        </div>
        {
          ["luna_pinyin_simp", "luna_pinyin"].includes(currentSchema) &&
          <div className={styles.formBox}>
            <FormControl className={styles.formControl}>
              <div className={styles.formLabel}>设置模糊音</div>
              <FormGroup row>
                {
                  fuzzyMap.map((fuzzy) =>
                    <FormControlLabel
                      control={
                        <Checkbox
                          value={fuzzy.value}
                          name={fuzzy.label}
                          checked={currentFuzzy.includes(fuzzy.value)}
                          onChange={async (e) => await this.actionChangeFuzzy(e.target.checked, e.target.value)}
                        />
                      }
                      label={fuzzy.label}
                      key={fuzzy.value}
                    />
                  )
                }
              </FormGroup>
            </FormControl>
          </div>
        }
      </div>
      <div className={styles.footer}>FydeOS is made possible by gentle souls with real ❤️</div>
      <Snackbar
        anchorOrigin={{
          vertical: 'top',
          horizontal: 'center',
        }}
        open={snackbarOpen}
        autoHideDuration={3000}
        ContentProps={{
          'aria-describedby': 'message-id',
        }}
        onClose={() => this.setState({ snackbarOpen: false, snackbarText: "" })}
        message={<span id="message-id">{snackbarText}</span>}
      />
    </div>
        </ThemeProvider>

    }
}

// @ts-ignore
export default Home;
